import { motion } from 'framer-motion';
import { SceneLayout, SafeFrame, VideoText, MediaFrame } from '@/lib/video';

export function Scene3() {
  return (
    <SafeFrame>
      <motion.div className="scene-ambient" style={{ borderColor: 'rgba(57,168,240,.3)', left: '-24vmin', right: 'auto', top: '18vmin' }} animate={{ rotate: [-4, 7, -4], scale: [.94, 1.03, .94] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />
      <SceneLayout layout="stack" style={{ justifyContent: 'flex-start' }}>
        <motion.div className="scene-index" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .5, delay: .15 }}>03 / handoff</motion.div>
        <div style={{ marginTop: '8.5vmin' }}>
          <motion.p className="scene-kicker" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45, delay: .25 }}>Construct LC · contracts + deliveries</motion.p>
          <motion.div initial={{ opacity: 0, y: 28, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .82, delay: .4, ease: [0.16, 1, .3, 1] }}>
            <VideoText as="h1" scale="display" className="scene-title">From <em>yes</em><br />to on-site.</VideoText>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, delay: .84 }}>
            <VideoText as="p" scale="body" className="scene-copy">Contract, delivery, and the next handoff share one source of truth.</VideoText>
          </motion.div>
        </div>
        <motion.div className="paper-card" style={{ bottom: '7.6vmin', padding: '3.5vmin 3.3vmin', position: 'absolute', right: '7vmin', width: '60vmin' }} initial={{ opacity: 0, y: 34, rotate: 2 }} animate={{ opacity: 1, y: [34, 0, -3, 0], rotate: [2, -.5, .2, 0] }} transition={{ duration: 1.05, delay: 1.25, ease: [0.16, 1, .3, 1] }}>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
            <span className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.1vmin', letterSpacing: '.15em' }}>project 042 · in motion</span>
            <span style={{ color: 'var(--color-success)', fontFamily: 'var(--font-mono)', fontSize: '1.1vmin', letterSpacing: '.12em', textTransform: 'uppercase' }}>contracted</span>
          </div>
          <motion.div className="mini-rule" style={{ margin: '2.4vmin 0 2.7vmin' }} initial={{ scaleX: 0, transformOrigin: 'left' }} animate={{ scaleX: 1 }} transition={{ duration: .9, delay: 1.55 }} />
          <motion.div
            style={{ height: '10vmin', marginBottom: '2.5vmin', width: '100%' }}
            initial={{ opacity: 0, scale: .96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: .8, delay: 1.45, ease: [0.16, 1, .3, 1] }}
          >
            <MediaFrame className="asset-photo">
              <img
                alt=""
                src={`${import.meta.env.BASE_URL}delivery-stack.jpg`}
                style={{ objectPosition: 'center 45%' }}
              />
            </MediaFrame>
          </motion.div>
          <div style={{ display: 'grid', gap: '2.5vmin', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {[
              ['contract', 'signed', '✓'],
              ['delivery', '72%', '→'],
              ['install', 'next', '○'],
            ].map(([label, value, icon], index) => (
              <motion.div key={label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45, delay: 1.65 + index * .15 }}>
                <div className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.05vmin', letterSpacing: '.12em', textTransform: 'uppercase' }}>{label}</div>
                <div style={{ alignItems: 'baseline', display: 'flex', gap: '1vmin', marginTop: '1.3vmin' }}><span style={{ color: index === 0 ? 'var(--color-success)' : 'var(--color-bg-dark)', fontSize: '2.25vmin', fontWeight: 600 }}>{value}</span><span className="mono" style={{ color: 'var(--color-accent)', fontSize: '2vmin' }}>{icon}</span></div>
              </motion.div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid rgba(6,43,85,.12)', marginTop: '3vmin', paddingTop: '2.4vmin' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.1vmin', letterSpacing: '.12em' }}>delivery readiness</span><span className="mono" style={{ color: 'var(--color-primary)', fontSize: '1.1vmin' }}>72 / 100</span></div>
            <div style={{ background: 'rgba(6,43,85,.1)', height: '.8vmin', marginTop: '1.25vmin', overflow: 'hidden' }}><motion.div style={{ background: 'var(--color-primary)', height: '100%', transformOrigin: 'left', width: '72%' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.05, delay: 1.85, ease: [0.16, 1, .3, 1] }} /></div>
          </div>
        </motion.div>
      </SceneLayout>
    </SafeFrame>
  );
}