"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type RefObject,
} from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useMotionValueEvent,
} from "framer-motion";

const CSMT_TOTAL_FRAMES = 240;
const DRIVE_TOTAL_FRAMES = 240;
const CSMT_PHASE_END = 0.4;
const SCENE_SCROLL_HEIGHT_VH = 560;
const MEDIA_CDN_BASE = "https://cdn.jsdelivr.net/gh/VinitSurve/media@main";
const SCROLL_SMOOTHING = 0.18;
const UI_PROGRESS_FPS = 16;
const UI_PROGRESS_STEPS = 220;
const FRAME_QUEUE_BACK = 8;
const FRAME_QUEUE_AHEAD = 28;
const CRITICAL_CSMT_FRAMES = 28;
const CRITICAL_DRIVE_FRAMES = 12;
const MAX_FRAME_CONCURRENCY = 8;

const CSMT_FRAME_PATH = (i: number) =>
  `${MEDIA_CDN_BASE}/frame_${String(i).padStart(4, "0")}.webp`;
const DRIVE_FRAME_PATH = (i: number) =>
  `${MEDIA_CDN_BASE}/drive_${String(i).padStart(4, "0")}.webp`;

interface StoryBeat {
  id: string;
  start: number;
  end: number;
  headline: string;
}

const STORY_BEATS: StoryBeat[] = [
  {
    id: "transition",
    start: 0.39,
    end: 0.53,
    headline: "Every journey begins somewhere",
  },
  {
    id: "mid-drive",
    start: 0.57,
    end: 0.73,
    headline: "Mumbai moves. We move with it.",
  },
  {
    id: "sealink-reveal",
    start: 0.79,
    end: 0.95,
    headline: "Connecting builders across the city",
  },
];

type SceneName = "csmt" | "drive";
type Priority = "high" | "low";

type FrameStore = RefObject<Array<HTMLImageElement | null>>;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number) {
  const x = clamp01(value);
  return 1 - Math.pow(1 - x, 3);
}

function easeInOutSine(value: number) {
  const x = clamp01(value);
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

function getSceneProgress(progress: number): {
  scene: SceneName;
  localProgress: number;
} {
  const normalized = clamp01(progress);

  if (normalized <= CSMT_PHASE_END) {
    return {
      scene: "csmt",
      localProgress: clamp01(normalized / CSMT_PHASE_END),
    };
  }

  return {
    scene: "drive",
    localProgress: clamp01((normalized - CSMT_PHASE_END) / (1 - CSMT_PHASE_END)),
  };
}

function findNearestLoadedFrame(
  frames: Array<HTMLImageElement | null>,
  targetIndex: number,
  maxDistance = 12
) {
  const direct = frames[targetIndex];
  if (direct?.complete && direct.naturalWidth) return direct;

  for (let distance = 1; distance <= maxDistance; distance++) {
    const back = frames[targetIndex - distance];
    if (back?.complete && back.naturalWidth) return back;

    const forward = frames[targetIndex + distance];
    if (forward?.complete && forward.naturalWidth) return forward;
  }

  return null;
}

function makeQueueKey(scene: SceneName, index: number) {
  return `${scene}:${index}`;
}

function parseQueueKey(key: string): { scene: SceneName; index: number } {
  const [sceneRaw, indexRaw] = key.split(":");
  return {
    scene: sceneRaw === "drive" ? "drive" : "csmt",
    index: Number(indexRaw),
  };
}

function useFramePreloader() {
  const [loaded, setLoaded] = useState(false);
  const [percent, setPercent] = useState(0);

  const csmtFramesRef = useRef<Array<HTMLImageElement | null>>(
    Array.from({ length: CSMT_TOTAL_FRAMES }, () => null)
  );
  const driveFramesRef = useRef<Array<HTMLImageElement | null>>(
    Array.from({ length: DRIVE_TOTAL_FRAMES }, () => null)
  );

  const criticalTargetsRef = useRef<Set<string>>(new Set());
  const criticalSettledRef = useRef<Set<string>>(new Set());
  const queuedRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<{ high: string[]; low: string[] }>({
    high: [],
    low: [],
  });
  const activeLoadsRef = useRef(0);
  const mountedRef = useRef(false);

  const getSceneTotal = useCallback((scene: SceneName) => {
    return scene === "csmt" ? CSMT_TOTAL_FRAMES : DRIVE_TOTAL_FRAMES;
  }, []);

  const getSceneFrames = useCallback((scene: SceneName) => {
    return scene === "csmt" ? csmtFramesRef.current : driveFramesRef.current;
  }, []);

  const getScenePath = useCallback((scene: SceneName, frameOneBased: number) => {
    return scene === "csmt"
      ? CSMT_FRAME_PATH(frameOneBased)
      : DRIVE_FRAME_PATH(frameOneBased);
  }, []);

  const updateCriticalProgress = useCallback(() => {
    if (!mountedRef.current) return;

    const total = criticalTargetsRef.current.size;
    if (total === 0) return;

    const settled = criticalSettledRef.current.size;
    const nextPercent = Math.round((settled / total) * 100);

    setPercent((prev) => (prev === nextPercent ? prev : nextPercent));

    if (settled >= total) {
      setLoaded(true);
    }
  }, []);

  const markCriticalSettled = useCallback(
    (key: string) => {
      if (!criticalTargetsRef.current.has(key)) return;
      if (criticalSettledRef.current.has(key)) return;

      criticalSettledRef.current.add(key);
      updateCriticalProgress();
    },
    [updateCriticalProgress]
  );

  const pumpQueueRef = useRef<() => void>(() => undefined);

  const finishLoad = useCallback(
    (key: string, scene: SceneName, index: number, img: HTMLImageElement | null) => {
      loadingRef.current.delete(key);
      activeLoadsRef.current = Math.max(0, activeLoadsRef.current - 1);

      if (img) {
        getSceneFrames(scene)[index] = img;
      }

      markCriticalSettled(key);
      pumpQueueRef.current();
    },
    [getSceneFrames, markCriticalSettled]
  );

  const startLoad = useCallback(
    (scene: SceneName, index: number, key: string) => {
      const total = getSceneTotal(scene);
      if (index < 0 || index >= total) return;

      const frames = getSceneFrames(scene);
      const existing = frames[index];
      if (existing?.complete && existing.naturalWidth) {
        markCriticalSettled(key);
        return;
      }

      loadingRef.current.add(key);
      activeLoadsRef.current += 1;

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.loading = "eager";
      img.src = getScenePath(scene, index + 1);

      img.onload = () => {
        img.onload = null;
        img.onerror = null;
        finishLoad(key, scene, index, img);
      };

      img.onerror = () => {
        img.onload = null;
        img.onerror = null;
        finishLoad(key, scene, index, null);
      };
    },
    [finishLoad, getSceneFrames, getScenePath, getSceneTotal, markCriticalSettled]
  );

  const pumpQueue = useCallback(() => {
    while (activeLoadsRef.current < MAX_FRAME_CONCURRENCY) {
      const key = queueRef.current.high.shift() ?? queueRef.current.low.shift();
      if (!key) break;

      queuedRef.current.delete(key);
      const { scene, index } = parseQueueKey(key);
      startLoad(scene, index, key);
    }
  }, [startLoad]);

  useEffect(() => {
    pumpQueueRef.current = pumpQueue;
  }, [pumpQueue]);

  const enqueueFrame = useCallback(
    (scene: SceneName, index: number, priority: Priority = "high") => {
      const total = getSceneTotal(scene);
      if (index < 0 || index >= total) return;

      const key = makeQueueKey(scene, index);
      const frames = getSceneFrames(scene);

      if (frames[index]?.complete && frames[index]?.naturalWidth) {
        markCriticalSettled(key);
        return;
      }

      if (loadingRef.current.has(key)) return;
      if (queuedRef.current.has(key)) return;

      queuedRef.current.add(key);
      queueRef.current[priority].push(key);
      pumpQueueRef.current();
    },
    [getSceneFrames, getSceneTotal, markCriticalSettled]
  );

  const queueNeighborhood = useCallback(
    (
      scene: SceneName,
      centerIndex: number,
      back = FRAME_QUEUE_BACK,
      ahead = FRAME_QUEUE_AHEAD
    ) => {
      for (let offset = -back; offset <= ahead; offset++) {
        enqueueFrame(scene, centerIndex + offset, "high");
      }

      enqueueFrame(scene, centerIndex + ahead + 16, "low");
      enqueueFrame(scene, centerIndex + ahead + 28, "low");
    },
    [enqueueFrame]
  );

  useEffect(() => {
    mountedRef.current = true;

    criticalTargetsRef.current.clear();
    criticalSettledRef.current.clear();

    for (let i = 0; i < CRITICAL_CSMT_FRAMES; i++) {
      criticalTargetsRef.current.add(makeQueueKey("csmt", i));
    }

    for (let i = 0; i < CRITICAL_DRIVE_FRAMES; i++) {
      criticalTargetsRef.current.add(makeQueueKey("drive", i));
    }

    updateCriticalProgress();

    for (let i = 0; i < CRITICAL_CSMT_FRAMES; i++) {
      enqueueFrame("csmt", i, "high");
    }

    for (let i = 0; i < CRITICAL_DRIVE_FRAMES; i++) {
      enqueueFrame("drive", i, "high");
    }

    // Keep a little runway queued for immediate smoothness after load.
    for (let i = CRITICAL_CSMT_FRAMES; i < CRITICAL_CSMT_FRAMES + 12; i++) {
      enqueueFrame("csmt", i, "low");
    }

    for (let i = CRITICAL_DRIVE_FRAMES; i < CRITICAL_DRIVE_FRAMES + 20; i++) {
      enqueueFrame("drive", i, "low");
    }

    return () => {
      mountedRef.current = false;
    };
  }, [enqueueFrame, updateCriticalProgress]);

  return {
    loaded,
    percent,
    csmtFrames: csmtFramesRef as FrameStore,
    driveFrames: driveFramesRef as FrameStore,
    queueNeighborhood,
  };
}

function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  csmtFrames: FrameStore,
  driveFrames: FrameStore,
  queueNeighborhood: (
    scene: SceneName,
    centerIndex: number,
    back?: number,
    ahead?: number
  ) => void,
  progressRef: RefObject<number>,
  isLoaded: boolean
) {
  const lastDrawnProgress = useRef(-1);
  const lastDrawnScene = useRef<SceneName | null>(null);
  const lastQueuedBucketRef = useRef("");
  const lastScrollTimeRef = useRef(0);
  const lastProgressRef = useRef(0);
  const scrollVelocityRef = useRef(0);
  const isScrollingRef = useRef(false);
  const scrollStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drawFrame = useCallback(
    (force = false) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const progress = clamp01(progressRef.current);
      const { scene, localProgress } = getSceneProgress(progress);
      const activeFrames =
        scene === "csmt" ? csmtFrames.current : driveFrames.current;

      if (!activeFrames.length) return;

      // Track scroll velocity to detect when scrolling stops
      if (lastScrollTimeRef.current === 0) {
        lastScrollTimeRef.current = Date.now();
      }
      const now = Date.now();
      const timeDelta = Math.max(1, now - lastScrollTimeRef.current);
      const progressDelta = Math.abs(progress - lastProgressRef.current);
      const velocity = progressDelta / timeDelta;
      scrollVelocityRef.current = velocity;

      // Detect if scrolling stopped (velocity near zero for 100ms)
      if (velocity < 0.00001) {
        isScrollingRef.current = false;
        if (scrollStopTimeoutRef.current) clearTimeout(scrollStopTimeoutRef.current);
      } else {
        isScrollingRef.current = true;
        if (scrollStopTimeoutRef.current) clearTimeout(scrollStopTimeoutRef.current);
        scrollStopTimeoutRef.current = setTimeout(() => {
          isScrollingRef.current = false;
        }, 100);
      }

      lastProgressRef.current = progress;
      lastScrollTimeRef.current = now;

      const totalFrames = activeFrames.length;
      const exactFrame = localProgress * (totalFrames - 1);
      
      // Snap to nearest frame when scrolling stops (crisp keyframe)
      // Otherwise interpolate smoothly
      let baseIndex: number;
      let blendProgress: number;
      
      if (isScrollingRef.current) {
        // Smooth interpolation while scrolling
        baseIndex = Math.floor(exactFrame);
        blendProgress = exactFrame - baseIndex;
      } else {
        // Snap to nearest keyframe when stopped for crisp, sharp frame
        baseIndex = Math.round(exactFrame);
        blendProgress = 0;
      }

      const nextIndex = Math.min(totalFrames - 1, baseIndex + 1);

      const queueBucket = `${scene}:${Math.floor(baseIndex / 2)}`;
      if (queueBucket !== lastQueuedBucketRef.current) {
        queueNeighborhood(scene, baseIndex);

        if (scene === "csmt" && progress > 0.24) {
          const driveLead = Math.floor(
            clamp01((progress - 0.24) / (1 - 0.24)) *
              Math.min(70, DRIVE_TOTAL_FRAMES - 1)
          );
          queueNeighborhood("drive", driveLead, 4, 18);
        }

        lastQueuedBucketRef.current = queueBucket;
      }

      const baseImg = findNearestLoadedFrame(activeFrames, baseIndex, 12);
      if (!baseImg) return;

      const nextImg = findNearestLoadedFrame(activeFrames, nextIndex, 12);

      const delta = Math.abs(progress - lastDrawnProgress.current);
      if (!force && scene === lastDrawnScene.current && delta < 0.0004) {
        return;
      }
      lastDrawnProgress.current = progress;
      lastDrawnScene.current = scene;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Enable explicit image smoothing for crisp rendering
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const imgRatio = baseImg.naturalWidth / baseImg.naturalHeight;
      const canvasRatio = w / h;
      let drawW: number;
      let drawH: number;
      let drawX: number;
      let drawY: number;

      if (canvasRatio > imgRatio) {
        drawW = w;
        drawH = w / imgRatio;
        drawX = 0;
        drawY = (h - drawH) / 2;
      } else {
        drawH = h;
        drawW = h * imgRatio;
        drawX = (w - drawW) / 2;
        drawY = 0;
      }

      if (scene === "drive") {
        const zoom = 1 + 0.05 * easeOutCubic(localProgress);
        const drift = Math.sin(localProgress * Math.PI * 4) * (w * 0.009);
        drawW *= zoom;
        drawH *= zoom;
        drawX = (w - drawW) / 2 + drift;
        drawY = (h - drawH) / 2 - (zoom - 1) * h * 0.08;
      } else {
        const transitionPush = easeOutCubic((localProgress - 0.72) / 0.28);
        const zoom = 1 + transitionPush * 0.015;
        drawW *= zoom;
        drawH *= zoom;
        drawX = (w - drawW) / 2 - transitionPush * w * 0.02;
        drawY = (h - drawH) / 2;
      }

      // Apply slight sharpness scale when scrolling (optical trick)
      const sharpnessScale = isScrollingRef.current ? 1.005 : 1.0;

      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.save();
      
      // Apply sharpness scale from center
      ctx.translate(drawX + drawW / 2, drawY + drawH / 2);
      ctx.scale(sharpnessScale, sharpnessScale);
      ctx.translate(-(drawX + drawW / 2), -(drawY + drawH / 2));
      
      ctx.drawImage(baseImg, drawX, drawY, drawW, drawH);

      if (
        blendProgress > 0.001 &&
        nextImg &&
        nextImg !== baseImg &&
        nextImg.complete &&
        nextImg.naturalWidth
      ) {
        ctx.globalAlpha = blendProgress;
        ctx.drawImage(nextImg, drawX, drawY, drawW, drawH);
        ctx.globalAlpha = 1;
      }
      
      ctx.restore();
    },
    [canvasRef, csmtFrames, driveFrames, progressRef, queueNeighborhood]
  );

  useEffect(() => {
    if (!isLoaded) return;

    let rafId = 0;

    const render = () => {
      drawFrame();
      rafId = window.requestAnimationFrame(render);
    };

    render();

    const onResize = () => {
      drawFrame(true);
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      if (scrollStopTimeoutRef.current) {
        clearTimeout(scrollStopTimeoutRef.current);
      }
    };
  }, [isLoaded, drawFrame]);
}

function getActiveStoryBeat(progress: number): StoryBeat | null {
  for (const beat of STORY_BEATS) {
    if (progress >= beat.start && progress <= beat.end) {
      return beat;
    }
  }
  return null;
}

function getBeatOpacity(progress: number, beat: StoryBeat): number {
  const fadeInDuration = 0.04;
  const fadeOutDuration = 0.05;
  const fadeInEnd = beat.start + fadeInDuration;
  const fadeOutStart = beat.end - fadeOutDuration;

  if (progress < fadeInEnd) {
    return Math.max(0, (progress - beat.start) / fadeInDuration);
  }

  if (progress > fadeOutStart) {
    return Math.max(0, (beat.end - progress) / fadeOutDuration);
  }

  return 1;
}

export default function ScrollScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetProgressRef = useRef(0);
  const smoothedProgressRef = useRef(0);
  const uiProgressRef = useRef(0);
  const [progress, setProgress] = useState(0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    targetProgressRef.current = clamp01(latest);
  });

  useEffect(() => {
    let rafId = 0;
    let lastUiCommit = 0;

    const tick = (now: number) => {
      const target = targetProgressRef.current;
      const prev = smoothedProgressRef.current;
      const next = prev + (target - prev) * SCROLL_SMOOTHING;
      const settled = Math.abs(target - next) < 0.0003 ? target : next;

      smoothedProgressRef.current = settled;

      if (now - lastUiCommit >= 1000 / UI_PROGRESS_FPS) {
        const quantized =
          Math.round(settled * UI_PROGRESS_STEPS) / UI_PROGRESS_STEPS;

        if (Math.abs(quantized - uiProgressRef.current) >= 1 / UI_PROGRESS_STEPS) {
          uiProgressRef.current = quantized;
          setProgress(quantized);
        }

        lastUiCommit = now;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const { loaded, percent, csmtFrames, driveFrames, queueNeighborhood } =
    useFramePreloader();

  useCanvasRenderer(
    canvasRef,
    csmtFrames,
    driveFrames,
    queueNeighborhood,
    smoothedProgressRef,
    loaded
  );

  const activeBeat = getActiveStoryBeat(progress);
  const beatOpacity = activeBeat ? getBeatOpacity(progress, activeBeat) : 0;
  const activeScene = getSceneProgress(progress);

  const frameTotal =
    activeScene.scene === "csmt" ? CSMT_TOTAL_FRAMES : DRIVE_TOTAL_FRAMES;
  const frameLabel = Math.min(
    frameTotal,
    Math.floor(activeScene.localProgress * frameTotal) + 1
  );

  const gradeOverlayStyle = useMemo(() => {
    const warmStrength = clamp01(1 - progress / CSMT_PHASE_END);
    const neutralStrength = clamp01(
      1 - Math.abs((progress - CSMT_PHASE_END) / 0.2)
    );
    const coolStrength = clamp01((progress - 0.55) / 0.45);

    return {
      background: `linear-gradient(180deg, rgba(248,178,91,${
        0.14 * warmStrength + 0.04 * neutralStrength
      }) 0%, rgba(126,144,168,${0.09 * neutralStrength}) 48%, rgba(91,134,198,${
        0.16 * coolStrength + 0.03 * neutralStrength
      }) 100%)`,
    };
  }, [progress]);

  const vignetteOpacity =
    activeScene.scene === "drive"
      ? 0.42 + activeScene.localProgress * 0.18
      : 0.36 + progress * 0.12;

  const fogOpacity = clamp01((progress - 0.34) / 0.44) * 0.34;
  const reflectionOpacity =
    activeScene.scene === "drive"
      ? 0.08 + easeInOutSine(activeScene.localProgress) * 0.24
      : 0;

  return (
    <>
      <div className={`loader-container ${loaded ? "loaded" : ""}`} aria-hidden={loaded}>
        <div className="loader-ring" />
        <p className="loader-text">Loading Mumbai to Sea Link</p>
        <p className="loader-percent">{percent}%</p>
      </div>

      <div className="progress-bar" style={{ width: `${progress * 100}%` }} />

      <motion.header
        className="nav-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: loaded ? 1 : 0, y: loaded ? 0 : -20 }}
        transition={{ duration: 1, delay: 0.5 }}
      >
        <span className="nav-logo">GDG Cloud Mumbai</span>
        <span className="nav-badge">CSMT to Sea Link | POV Drive</span>
      </motion.header>

      <div
        ref={containerRef}
        style={{ height: `${SCENE_SCROLL_HEIGHT_VH}vh`, position: "relative" }}
      >
        <canvas
          ref={canvasRef}
          className="scroll-canvas"
          aria-label="Cinematic Mumbai scene evolving from CSMT to a Sea Link POV drive"
        />

        <div className="canvas-grade-shift" style={gradeOverlayStyle} />
        <div className="canvas-fog" style={{ opacity: fogOpacity }} />
        <div className="canvas-reflection" style={{ opacity: reflectionOpacity }} />
        <div className="canvas-vignette" style={{ opacity: vignetteOpacity }} />
        <div className="canvas-top-fade" />
        <div className="canvas-bottom-fade" />
        <div className="film-grain" />

        <AnimatePresence mode="wait">
          {activeBeat && (
            <motion.div
              key={activeBeat.id}
              className="story-overlay story-overlay--road-safe"
              initial={{ opacity: 0 }}
              animate={{ opacity: beatOpacity }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <motion.h2
                className="story-headline story-headline--medium"
                initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
                animate={{
                  opacity: beatOpacity,
                  y: 0,
                  filter: "blur(0px)",
                }}
                exit={{ opacity: 0, y: -14, filter: "blur(4px)" }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              >
                {activeBeat.headline}
              </motion.h2>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          className="scroll-indicator"
          initial={{ opacity: 0 }}
          animate={{ opacity: progress < 0.04 && loaded ? 1 : 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="scroll-indicator-text">Scroll</span>
          <span className="scroll-indicator-line" />
        </motion.div>
      </div>

      <section className="cta-section">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true, amount: 0.3 }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div className="gold-divider" />
          <h2 className="cta-title">Join the Cloud Community</h2>
          <p className="cta-description">
            GDG Cloud Mumbai brings together developers, architects, and
            visionaries building the future on Google Cloud. From workshops to
            hackathons - this is where builders become leaders.
          </p>
          <a
            href="https://gdg.community.dev/gdg-cloud-mumbai/"
            target="_blank"
            rel="noopener noreferrer"
            className="cta-button"
          >
            Explore Events
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              style={{ marginLeft: 4 }}
            >
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </motion.div>
      </section>

      <div className="frame-counter">
        {activeScene.scene === "csmt" ? "CSMT" : "DRIVE"} {frameLabel} / {frameTotal}
      </div>
    </>
  );
}
