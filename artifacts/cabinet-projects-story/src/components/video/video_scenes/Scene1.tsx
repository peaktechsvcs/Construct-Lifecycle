import { motion } from 'framer-motion';
import { SceneLayout } from '@/lib/video';

const materials = [
  { label: 'cabinetry', color: '#062B55', rotate: -8 },
  { label: 'surfaces', color: '#D9DEE3', rotate: 3 },
  { label: 'flooring', color: '#6B7075', rotate: 9 },
  { label: 'lighting', color: '#39A8F0', rotate: -3 },
  { label: 'hardware', color: '#1479C9', rotate: 7 },
];

export function Scene1() {
  return (
    <div className="scene-safe">
      <motion.div className="scene-ambient" animate={{ rotate: [0, 8, -4, 0], scale: [1, 1.04, .97, 1] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
      <SceneLayout layout="stack" style={{ justifyContent: 'flex-start' }}>
        <motion.div className="scene-index" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .55, delay: .2 }}>
          01 / opportunity
        </motion.div>
        <div style={{ marginTop: '9vmin', position: 'relative' }}>
          <motion.p className="scene-kicker" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, delay: .35 }}>
            Construct LC · opportunities
          </motion.p>
          <motion.h1 className="scene-title" initial={{ opacity: 0, y: 30, scale: .94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .85, delay: .48, ease: [0.16, 1, .3, 1] }}>
            Start with<br /><em>the maybe.</em>
          </motion.h1>
          <motion.p className="scene-copy" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: 1.05 }}>
            One opportunity. Every material, note, and next step in the same working ledger.
          </motion.p>
        </div>
        <motion.div
          className="paper-card"
          style={{ bottom: '10vmin', padding: '3.4vmin 3.2vmin', position: 'absolute', right: '8vmin', width: '46vmin' }}
          initial={{ opacity: 0, y: 40, rotate: 5 }}
          animate={{ opacity: 1, y: [40, 0, -4, 0], rotate: [5, -1, 1, 0] }}
          transition={{ duration: 1.05, delay: 1.55, ease: [0.16, 1, .3, 1] }}
        >
          <div className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.25vmin', letterSpacing: '.14em', textTransform: 'uppercase' }}>new opportunity · 042</div>
          <motion.img
            alt=""
            className="asset-photo"
            src={`${import.meta.env.BASE_URL}material-board.jpg`}
            style={{ height: '10vmin', objectPosition: 'center 60%', position: 'absolute', right: '3.2vmin', top: '2.7vmin', width: '13vmin' }}
            initial={{ opacity: 0, scale: .9, rotate: 4 }}
            animate={{ opacity: 1, scale: 1, rotate: 3 }}
            transition={{ duration: .7, delay: 1.35, ease: [0.16, 1, .3, 1] }}
          />
          <div className="mini-rule" style={{ margin: '2.3vmin 0' }} />
          <div style={{ display: 'grid', gap: '1.35vmin', gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {materials.map((material, index) => (
              <motion.div key={material.label} style={{ textAlign: 'center' }} initial={{ opacity: 0, y: 18, rotate: material.rotate }} animate={{ opacity: 1, y: [18, 0, -2, 0], rotate: [material.rotate, 0, material.rotate / 2, 0] }} transition={{ duration: .65, delay: 1.75 + index * .12, ease: [0.16, 1, .3, 1] }}>
                <div style={{ background: material.color, border: '1px solid rgba(6,43,85,.16)', height: '7.5vmin', marginBottom: '.9vmin', width: '100%' }} />
                <div className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '.95vmin', letterSpacing: '.04em' }}>{material.label}</div>
              </motion.div>
            ))}
          </div>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginTop: '3vmin', paddingRight: '16vmin' }}>
            <span className="mono" style={{ color: 'var(--color-text-secondary)', fontSize: '1.2vmin' }}>oak / brass / stone</span>
            <motion.span className="mono" style={{ color: 'var(--color-primary)', fontSize: '1.2vmin' }} animate={{ opacity: [.35, 1, .35] }} transition={{ duration: 1.8, repeat: Infinity }}>capturing…</motion.span>
          </div>
        </motion.div>
      </SceneLayout>
    </div>
  );
}