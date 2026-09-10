import { motion } from 'framer-motion';
import { SceneLayout } from '@/lib/video';

export function Scene4() {
  return (
    <div className="scene-safe">
      <motion.div className="scene-ambient" style={{ height: '48vmin', right: '-22vmin', top: '31vmin', width: '48vmin' }} animate={{ rotate: [0, -14, 6, 0], x: [0, -2, 3, 0] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
      <SceneLayout layout="stack" style={{ justifyContent: 'flex-start' }}>
        <motion.div className="scene-index" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .5, delay: .15 }}>04 / billing + closeout</motion.div>
        <div style={{ marginTop: '8.5vmin' }}>
          <motion.p className="scene-kicker" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45, delay: .25 }}>Finish the job without losing the thread</motion.p>
          <motion.h1 className="scene-title" initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .78, delay: .4, ease: [0.16, 1, .3, 1] }}>Good work<br /><em>gets closed.</em></motion.h1>
          <motion.p className="scene-copy" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, delay: .82 }}>See what is invoiced, what is received, and what still needs a final look.</motion.p>
        </div>
        <motion.div className="paper-card" style={{ bottom: '8.2vmin', left: '14vmin', padding: '3.6vmin 3.3vmin', position: 'absolute', width: '61vmin' }} initial={{ opacity: 0, x: -24, rotate: -2 }} animate={{ opacity: 1, x: 0, rotate: [-2, .5, 0] }} transition={{ duration: .95, delay: 1.22, ease: [0.16, 1, .3, 1] }}>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}><span className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.1vmin', letterSpacing: '.15em' }}>closeout ledger · 042</span><span style={{ color: 'var(--color-success)', fontFamily: 'var(--font-mono)', fontSize: '1.08vmin', letterSpacing: '.12em', textTransform: 'uppercase' }}>ready to close</span></div>
          <div className="mini-rule" style={{ margin: '2.4vmin 0 2.9vmin' }} />
          <div style={{ display: 'grid', gap: '3.2vmin', gridTemplateColumns: '1fr 1fr' }}>
            <div><div className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.05vmin', letterSpacing: '.12em', textTransform: 'uppercase' }}>received</div><div style={{ color: 'var(--color-bg-dark)', fontFamily: 'var(--font-mono)', fontSize: '4.1vmin', letterSpacing: '-.08em', marginTop: '1.1vmin' }}>$41,280</div><div style={{ color: 'var(--color-success)', fontSize: '1.35vmin', marginTop: '1vmin' }}>84.7% of invoiced</div></div>
            <div><div className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.05vmin', letterSpacing: '.12em', textTransform: 'uppercase' }}>closeout</div><div style={{ color: 'var(--color-bg-dark)', fontFamily: 'var(--font-mono)', fontSize: '4.1vmin', letterSpacing: '-.08em', marginTop: '1.1vmin' }}>6 / 6</div><div style={{ color: 'var(--color-accent)', fontSize: '1.35vmin', marginTop: '1vmin' }}>punch list complete</div></div>
          </div>
          <motion.div style={{ border: '1px solid rgba(201,107,74,.42)', color: 'var(--color-accent)', fontFamily: 'var(--font-mono)', fontSize: '1.3vmin', letterSpacing: '.18em', marginTop: '3.6vmin', padding: '1.25vmin', textAlign: 'center', textTransform: 'uppercase' }} initial={{ opacity: 0, scale: .88, rotate: -4 }} animate={{ opacity: 1, scale: 1, rotate: -3 }} transition={{ duration: .55, delay: 2.05, ease: [0.16, 1, .3, 1] }}>job closed · june 18</motion.div>
        </motion.div>
      </SceneLayout>
    </div>
  );
}