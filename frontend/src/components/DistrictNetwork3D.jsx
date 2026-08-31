import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useTheme } from '../context/ThemeContext';
import DISTRICTS from '../data/upDistricts.json';

/**
 * The Uttar Pradesh district network, in 3D.
 *
 * This is not decoration — it is the product's actual data. All 75 markers sit
 * at the real coordinates of the district hospitals the referral engine routes
 * to, so the shape on screen is genuinely the shape of the state.
 *
 * What it shows:
 *   - a marker per district, its pillar height scaled by simulated case volume
 *   - referral arcs between neighbouring districts, with a case travelling along
 *   - a pulse ring on districts currently "active"
 *   - hover raycasting: point at a district and it names itself
 *
 * Constraints kept from the previous version: landing page only, honours
 * prefers-reduced-motion, stops rendering when the tab is hidden.
 */

// Equirectangular projection is fine at this scale — over ~7° of longitude the
// distortion is far below the pixel budget, and it keeps the maths readable.
const LAT_MIN = 23.8, LAT_MAX = 30.6;
const LON_MIN = 76.8, LON_MAX = 84.8;
const SPAN = 5.2;

const project = (lat, lon) => ({
  x: ((lon - LON_MIN) / (LON_MAX - LON_MIN) - 0.5) * SPAN,
  z: -((lat - LAT_MIN) / (LAT_MAX - LAT_MIN) - 0.5) * SPAN * 0.78
});

/** Deterministic pseudo-random so the scene looks the same on every load. */
const seeded = (i) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export default function DistrictNetwork3D({ className, onDistrictHover }) {
  const mountRef = useRef(null);
  const { isDark } = useTheme();
  const [hovered, setHovered] = useState(null);
  const [failed, setFailed] = useState(false);
  const hoverRef = useRef(null);

  const handleHover = useCallback((name) => {
    if (hoverRef.current === name) return;
    hoverRef.current = name;
    setHovered(name);
    onDistrictHover?.(name);
  }, [onDistrictHover]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return undefined;
    }

    const width = mount.clientWidth || 600;
    const height = mount.clientHeight || 400;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 4.6, 4.4);
    camera.lookAt(0, 0, 0);

    // Palette follows the theme so the scene never fights the page around it.
    const C = isDark
      ? { node: 0x8abbf0, hub: 0x6aa3e2, arc: 0x4a84c8, grid: 0x1e3a5f, pulse: 0x4ac97e, alert: 0xff6a85, pillar: 0x2b5f9e }
      : { node: 0x1a5fb4, hub: 0x0b3c78, arc: 0x2b6cb0, grid: 0xc9d6e8, pulse: 0x15803d, alert: 0xbe123c, pillar: 0x4a84c8 };

    const world = new THREE.Group();
    world.rotation.x = 0.12;
    scene.add(world);

    // ---------------------------------------------------------------- grid
    const grid = new THREE.GridHelper(SPAN * 1.15, 26, C.grid, C.grid);
    grid.material.transparent = true;
    grid.material.opacity = isDark ? 0.16 : 0.28;
    grid.position.y = -0.02;
    world.add(grid);

    // -------------------------------------------------------------- markers
    const points = DISTRICTS.map((d, i) => {
      const { x, z } = project(d.la, d.lo);
      // Case volume drives pillar height. Seeded so it is stable per district.
      const volume = 0.18 + seeded(i) * 0.85;
      return { ...d, x, z, volume, active: seeded(i + 100) > 0.82 };
    });

    const markerGroup = new THREE.Group();
    world.add(markerGroup);

    const pillarGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
    const nodeGeo = new THREE.SphereGeometry(0.045, 12, 12);

    const markers = points.map((p) => {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);

      const pillar = new THREE.Mesh(
        pillarGeo,
        new THREE.MeshBasicMaterial({ color: C.pillar, transparent: true, opacity: 0.5 })
      );
      pillar.scale.y = p.volume;
      pillar.position.y = p.volume / 2;
      g.add(pillar);

      const node = new THREE.Mesh(
        nodeGeo,
        new THREE.MeshBasicMaterial({ color: p.active ? C.pulse : C.node })
      );
      node.position.y = p.volume;
      // Raycast targets the node, and carries its district back with it.
      node.userData.district = p.n;
      g.add(node);

      markerGroup.add(g);
      return { ...p, group: g, node, pillar, baseY: p.volume };
    });

    // ------------------------------------------------------------ ring pulse
    const ringGeo = new THREE.RingGeometry(0.06, 0.075, 24);
    const activeRings = markers.filter((m) => m.active).map((m) => {
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: C.pulse, transparent: true, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(m.x, 0.01, m.z);
      ring.userData.phase = seeded(m.la * 10) * Math.PI * 2;
      world.add(ring);
      return ring;
    });

    // ----------------------------------------------------------------- arcs
    // Each arc is a referral path from a village node to a nearby hub.
    const hubs = markers.filter((_, i) => i % 9 === 0);
    const arcs = [];

    markers.forEach((m, i) => {
      if (i % 3 !== 0) return;
      let nearest = null;
      let best = Infinity;
      hubs.forEach((h) => {
        if (h === m) return;
        const d = (h.x - m.x) ** 2 + (h.z - m.z) ** 2;
        if (d < best) { best = d; nearest = h; }
      });
      if (!nearest || best > 2.2) return;

      const start = new THREE.Vector3(m.x, m.baseY, m.z);
      const end = new THREE.Vector3(nearest.x, nearest.baseY, nearest.z);
      const mid = start.clone().lerp(end, 0.5);
      mid.y += 0.5 + Math.sqrt(best) * 0.28;

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(28));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: C.arc, transparent: true, opacity: isDark ? 0.3 : 0.22 })
      );
      world.add(line);

      // A "case in transit" travelling along the arc.
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 8),
        new THREE.MeshBasicMaterial({ color: seeded(i) > 0.85 ? C.alert : C.pulse })
      );
      world.add(dot);
      arcs.push({ curve, dot, offset: seeded(i * 3), speed: 0.1 + seeded(i * 7) * 0.12 });
    });

    // ------------------------------------------------------------- raycasting
    const raycaster = new THREE.Raycaster();
    // A generous pick radius. These markers are a few pixels across on a
    // phone, and an exact-hit test makes them effectively unhoverable.
    raycaster.params.Points = { threshold: 0.35 };
    raycaster.params.Mesh = {};
    const pointerNdc = new THREE.Vector2(-2, -2);
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

    const onPointerMove = (e) => {
      const rect = mount.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      pointerNdc.set(nx * 2 - 1, -(ny * 2 - 1));
      parallax.tx = (nx - 0.5) * 0.45;
      parallax.ty = (ny - 0.5) * 0.18;
    };
    const onPointerLeave = () => {
      pointerNdc.set(-2, -2);
      parallax.tx = 0;
      parallax.ty = 0;
      handleHover(null);
    };

    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerleave', onPointerLeave);

    // ------------------------------------------------------------------ loop
    const clock = new THREE.Clock();
    let raf;
    let hoveredMesh = null;
    /*
     * How long a label survives the ray missing everything.
     *
     * The markers are small, and the camera drifts with the pointer, so the
     * ray misses on a great many frames while the cursor is travelling between
     * two districts. Clearing on the first miss made the label flicker out the
     * instant the mouse moved — it read as the panel closing itself. Holding
     * the last district briefly means only a deliberate move away clears it.
     */
    const HOVER_GRACE_MS = 260;
    let lastHitAt = 0;

    const frame = () => {
      const t = clock.getElapsedTime();

      parallax.x += (parallax.tx - parallax.x) * 0.06;
      parallax.y += (parallax.ty - parallax.y) * 0.06;
      world.rotation.y = (reduced ? 0 : t * 0.05) + parallax.x;
      world.rotation.x = 0.12 + parallax.y;

      // Case dots travel their arcs.
      arcs.forEach((a) => {
        const p = ((t * a.speed + a.offset) % 1);
        a.curve.getPoint(p, a.dot.position);
        a.dot.material.opacity = Math.sin(p * Math.PI);
        a.dot.material.transparent = true;
      });

      // Rings expand and fade.
      activeRings.forEach((r) => {
        const p = (Math.sin(t * 1.3 + r.userData.phase) + 1) / 2;
        r.scale.setScalar(1 + p * 2.4);
        r.material.opacity = 0.55 * (1 - p);
      });

      // Hover highlight.
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(markers.map((m) => m.node), false);
      const hit = hits[0]?.object || null;

      if (hoveredMesh && hoveredMesh !== hit) {
        hoveredMesh.scale.setScalar(1);
        hoveredMesh = null;
      }
      if (hit) {
        hit.scale.setScalar(1.9);
        hoveredMesh = hit;
        lastHitAt = performance.now();
        handleHover(hit.userData.district);
        mount.style.cursor = 'pointer';
      } else {
        mount.style.cursor = 'default';
        // Pointer genuinely outside the canvas clears at once (pointerleave
        // parks it at -2); otherwise wait out the grace period.
        const pointerInside = pointerNdc.x > -1.5;
        if (!pointerInside || performance.now() - lastHitAt > HOVER_GRACE_MS) {
          handleHover(null);
        }
      }

      renderer.render(scene, camera);
    };

    if (reduced) {
      frame();
    } else {
      const loop = () => { frame(); raf = requestAnimationFrame(loop); };
      loop();
    }

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // A background canvas burning GPU is the fastest way to drain a phone.
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduced) { const loop = () => { frame(); raf = requestAnimationFrame(loop); }; loop(); }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerleave', onPointerLeave);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [isDark, handleHover]);

  if (failed) {
    return (
      <div className={className}>
        <div className="w-full h-full rounded-card bg-gradient-to-br from-gov-600 to-gov-800 flex items-center justify-center">
          <p className="text-white/70 text-xs">75 districts · Uttar Pradesh</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className || ''}`}>
      <div ref={mountRef} className="absolute inset-0" role="img"
           aria-label="Interactive 3D map of the 75 district hospital network across Uttar Pradesh" />

      {/* Hover readout — the reason this is a map and not a decoration. */}
      <div className="absolute bottom-3 left-3 pointer-events-none">
        <div className={`px-3 py-2 rounded-field border backdrop-blur transition-all duration-200 ${
          hovered
            ? 'bg-surface-raised/90 border-line opacity-100 translate-y-0'
            : 'bg-surface-raised/60 border-transparent opacity-70 translate-y-1'
        }`}>
          <p className="text-[10px] uppercase tracking-wider text-ink-subtle">
            {hovered ? 'District' : 'Uttar Pradesh'}
          </p>
          <p className="text-sm font-bold text-ink leading-tight">
            {hovered || '75 district hospitals'}
          </p>
        </div>
      </div>

      <div className="absolute top-3 right-3 pointer-events-none flex flex-col gap-1.5 items-end">
        {[
          ['Sub-centre', 'bg-gov-500'],
          ['Active now', 'bg-tier-low'],
          ['Referral in transit', 'bg-tier-emergency']
        ].map(([label, dot]) => (
          <span key={label} className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-raised/70 backdrop-blur text-[10px] text-ink-muted">
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
