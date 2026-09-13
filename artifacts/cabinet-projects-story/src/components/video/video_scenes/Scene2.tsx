import { motion } from 'framer-motion';
import { SceneLayout } from '@/lib/video';

export function Scene2() {
  return (
    <div className="scene-safe">
      <motion.div className="scene-ambient" style={{ borderRadius: '2vmin', height: '46vmin', right: '-16vmin', top: '21vmin', width: '46vmin' }} animate={{ rotate: [8, 15, 4, 8], y: [0, 2, -3, 0] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />
      <SceneLayout layout="stack" style={{ justifyContent: 'flex-start' }}>
        <motion.div className="scene-index" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .5, delay: .16 }}>02 / proposal</motion.div>
        <div style={{ marginTop: '8.5vmin' }}>
          <motion.p className="scene-kicker" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45, delay: .28 }}>The scattered becomes specific</motion.p>
          <motion.h1 className="scene-title" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .78, delay: .42, ease: [0.16, 1, .3, 1] }}>Scope it.<br /><em>Show it.</em></motion.h1>
          <motion.p className="scene-copy" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, delay: .84 }}>Turn the brief into a proposal your customer can say yes to.</motion.p>
        </div>
        <motion.div className="paper-card" style={{ bottom: '8.5vmin', left: '14vmin', padding: '3.6vmin 3.3vmin 3.1vmin', position: 'absolute', width: '61vmin' }} initial={{ opacity: 0, x: -30, rotate: -3 }} animate={{ opacity: 1, x: 0, rotate: [-3, .7, 0] }} transition={{ duration: .95, delay: 1.25, ease: [0.16, 1, .3, 1] }}>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.15vmin', letterSpacing: '.15em' }}>proposal · 042</div>
              <div style={{ fontSize: '2.55vmin', fontWeight: 600, letterSpacing: '-.04em', marginTop: '1vmin' }}>Pacific Heights kitchen</div>
            </div>
            <div style={{ background: 'rgba(23,107,105,.12)', color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', fontSize: '1.05vmin', letterSpacing: '.12em', padding: '1vmin 1.2vmin', textTransform: 'uppercase' }}>ready to send</div>
          </div>
          <div className="mini-rule" style={{ margin: '2.5vmin 0 2.1vmin' }} />
          {['Walnut slab fronts', 'Taj Mahal surface', 'Brushed brass hardware'].map((line, index) => (
            <motion.div key={line} style={{ alignItems: 'center', borderBottom: index < 2 ? '1px solid rgba(23,45,50,.11)' : 'none', display: 'flex', justifyContent: 'space-between', padding: '1.1vmin 0' }} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .35, delay: 1.65 + index * .18 }}>
              <span style={{ fontSize: '1.8vmin' }}>{line}</span>
              <span className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.12vmin' }}>{['material', 'surface', 'hardware'][index]}</span>
            </motion.div>
          ))}
          <div style={{ alignItems: 'flex-end', display: 'flex', justifyContent: 'space-between', marginTop: '2.4vmin' }}>
            <span className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.08vmin', letterSpacing: '.06em' }}>scope / lead time / owner</span>
            <span style={{ color: 'var(--color-bg-dark)', fontFamily: 'var(--font-mono)', fontSize: '2.7vmin' }}>$48,720</span>
          </div>
        </motion.div>
      </SceneLayout>
    </div>
  );
}