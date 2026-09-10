import {
  SafeFrame,
  VideoCanvas,
  type VideoAspectRatio,
  useVideoPlayer,
} from '@/lib/video';
import { AnimatePresence, motion } from 'framer-motion';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = {
  opportunity: 5200,
  proposal: 4400,
  delivery: 5100,
  billing: 4300,
  followup: 5400,
};

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '9:16';

const scenes = [Scene1, Scene2, Scene3, Scene4, Scene5];

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({
    durations: SCENE_DURATIONS,
  });
  const Scene = scenes[currentScene] ?? Scene1;
  const activeScene = Math.min(currentScene, 4);

  return (
    <VideoCanvas
      aspectRatio={VIDEO_ASPECT_RATIO}
      className="story-root"
    >
      <SafeFrame>
        <header className="story-header">
          <div className="story-brand">
            <span className="brand-mark">
              <img alt="Construct Lifecycle" src={`${import.meta.env.BASE_URL}Construct_Lifecycle_icon.png`} />
            </span>
            <div>
              <div className="brand-name">Construct LC</div>
              <div className="brand-kicker">construction lifecycle platform</div>
            </div>
          </div>
          <div className="scene-label">Construct Lifecycle™</div>
        </header>

        <div className="persistent-rail" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <motion.span
              className="rail-dot"
              data-active={index === activeScene}
              key={index}
              animate={{
                scale: index === activeScene ? 1.14 : 1,
                opacity: index <= activeScene ? 1 : .5,
              }}
              transition={{ duration: .45, ease: [0.16, 1, .3, 1] }}
            />
          ))}
        </div>

        <motion.div
          aria-hidden="true"
          style={{
            background: 'rgba(20, 121, 201, .06)',
            border: '1px solid rgba(20, 121, 201, .2)',
            borderRadius: '50%',
            height: '42vmin',
            left: '14vmin',
            position: 'absolute',
            top: '25vmin',
            width: '42vmin',
            zIndex: 0,
          }}
          animate={{
            x: [0, '3vmin', '-2vmin', '4vmin', 0][activeScene] as number | string,
            y: [0, '-2vmin', '4vmin', '1vmin', '-3vmin'][activeScene] as number | string,
            scale: [1, .82, 1.1, .92, 1.16][activeScene],
            rotate: [0, 18, -14, 24, 0][activeScene],
          }}
          transition={{ duration: 1.1, ease: [0.16, 1, .3, 1] }}
        />

        <AnimatePresence mode="sync" initial={false}>
          <motion.div
            className="scene-wrap"
            key={activeScene}
            initial={{ clipPath: 'polygon(0 0, 0 0, 0 100%, 0 100%)', opacity: .7 }}
            animate={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', opacity: 1 }}
            exit={{ clipPath: 'polygon(100% 0, 100% 0, 100% 100%, 100% 100%)', opacity: .7 }}
            transition={{ duration: .9, ease: [0.16, 1, .3, 1] }}
          >
            <Scene />
          </motion.div>
        </AnimatePresence>
      </SafeFrame>
    </VideoCanvas>
  );
}
