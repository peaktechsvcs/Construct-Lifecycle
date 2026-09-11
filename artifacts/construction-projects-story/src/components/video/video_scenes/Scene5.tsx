import { motion } from 'framer-motion';
import { SceneLayout, SafeFrame, VideoText, MediaFrame } from '@/lib/video';

export function Scene5() {
  return (
    <SafeFrame>
      <motion.div className="scene-ambient" style={{ borderColor: 'rgba(20,121,201,.26)', height: '49vmin', left: '-21vmin', right: 'auto', top: '20vmin', width: '49vmin' }} animate={{ rotate: [0, -9, 9, 0], scale: [1, .96, 1.04, 1] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />
      <SceneLayout layout="stack" style={{ justifyContent: 'flex-start' }}>
        <motion.div className="scene-index" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .5, delay: .15 }}>05 / future work</motion.div>
        <div style={{ marginTop: '8.5vmin' }}>
          <motion.p className="scene-kicker" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45, delay: .24 }}>Construct Lifecycle · opportunities</motion.p>
          <motion.div initial={{ opacity: 0, y: 30, scale: .95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .82, delay: .38, ease: [0.16, 1, .3, 1] }}>
            <VideoText as="h1" scale="display" className="scene-title">Close one<br /><em>loop.</em></VideoText>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, delay: .83 }}>
            <VideoText as="p" scale="body" className="scene-copy">Then keep the next conversation close — while the details are still warm.</VideoText>
          </motion.div>
        </div>
        <motion.div className="paper-card" style={{ bottom: '8.6vmin', padding: '3.4vmin 3.3vmin', position: 'absolute', right: '7vmin', width: '60vmin' }} initial={{ opacity: 0, y: 30, rotate: 3 }} animate={{ opacity: 1, y: [30, 0, -3, 0], rotate: [3, -.5, .5, 0] }} transition={{ duration: 1.05, delay: 1.22, ease: [0.16, 1, .3, 1] }}>
          <motion.div
            style={{ float: 'right', height: '14vmin', margin: '0 0 2vmin 2.4vmin', width: '13vmin' }}
            initial={{ opacity: 0, scale: .9, rotate: -3 }}
            animate={{ opacity: 1, scale: 1, rotate: -3 }}
            transition={{ duration: .7, delay: 1.5, ease: [0.16, 1, .3, 1] }}
          >
            <MediaFrame className="asset-photo">
              <img
                alt=""
                src={`${import.meta.env.BASE_URL}jobsite-detail.jpg`}
                style={{ objectPosition: 'center 48%' }}
              />
            </MediaFrame>
          </motion.div>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}><span className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.1vmin', letterSpacing: '.15em' }}>follow-up queue · 042</span><span style={{ background: 'rgba(201,130,0,.12)', color: 'var(--color-warning)', fontFamily: 'var(--font-mono)', fontSize: '1.05vmin', letterSpacing: '.12em', padding: '.9vmin 1.1vmin', textTransform: 'uppercase' }}>in 30 days</span></div>
          <div className="mini-rule" style={{ margin: '2.5vmin 0 2.7vmin' }} />
          <div style={{ fontSize: '2.3vmin', fontWeight: 600, letterSpacing: '-.03em' }}>Ask about the library wall.</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: '1.55vmin', lineHeight: 1.35, marginTop: '1.35vmin', maxWidth: '43vmin' }}>Their kitchen is complete. The next room is already in the notes.</div>
          <div style={{ alignItems: 'center', borderTop: '1px solid rgba(6,43,85,.12)', display: 'flex', justifyContent: 'space-between', marginTop: '3.1vmin', paddingTop: '2.25vmin' }}><span className="mono" style={{ color: 'var(--color-primary)', fontSize: '1.12vmin', letterSpacing: '.1em', textTransform: 'uppercase' }}>owner · project team</span><motion.span className="mono" style={{ color: 'var(--color-primary)', fontSize: '1.1vmin', letterSpacing: '.1em' }} animate={{ x: [0, 4, 0] }} transition={{ duration: 1.7, repeat: Infinity }}>next conversation →</motion.span></div>
        </motion.div>
        <motion.img alt="Construct Lifecycle" className="formal-logo" src={`${import.meta.env.BASE_URL}Construct_Lifecycle_logo.png`} style={{ bottom: '2.2vmin', left: '14vmin', position: 'absolute', width: '23vmin' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.1, duration: .8 }} />
        <motion.div style={{ bottom: '2.9vmin', color: 'var(--color-primary)', fontFamily: 'var(--font-body)', fontSize: '1.22vmin', fontWeight: 700, left: '40vmin', letterSpacing: '.1em', position: 'absolute', textTransform: 'uppercase' }} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 2.25, duration: .7 }}>FROM BID TO CLOSEOUT.</motion.div>
      </SceneLayout>
    </SafeFrame>
  );
}