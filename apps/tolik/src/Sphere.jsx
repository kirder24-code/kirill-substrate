import React, { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The animated cyan sphere that is Tolik's face.
 *
 * Three layers:
 *   1. Inner glow sphere (additive, large soft halo)
 *   2. Icosahedron wireframe distorted by audio amplitude
 *   3. Particle field of ~1500 dots orbiting and reacting to volume
 *
 * Three states drive shader uniforms:
 *   "idle"      — slow rotation, low amplitude, particles drift
 *   "listening" — distortion follows mic input volume (0..1)
 *   "speaking"  — distortion follows playback volume + warmer color
 *   "thinking"  — fast rotation, no audio, soft pulse
 */
export default function Sphere({ state, audioLevel }) {
  const containerRef = useRef(null);
  const stateRef = useRef(state);
  const audioRef = useRef(audioLevel || 0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { audioRef.current = audioLevel ?? 0; }, [audioLevel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 6;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // ---- Sphere (icosahedron) wire ----
    const geom = new THREE.IcosahedronGeometry(1.6, 5);
    const sphereUniforms = {
      u_time: { value: 0 },
      u_audio: { value: 0 },
      u_state: { value: 0 }, // 0 idle, 1 listening, 2 speaking, 3 thinking
    };
    const sphereMat = new THREE.ShaderMaterial({
      uniforms: sphereUniforms,
      wireframe: true,
      transparent: true,
      vertexShader: /* glsl */`
        uniform float u_time;
        uniform float u_audio;
        uniform float u_state;
        varying float v_dist;
        // Classic Perlin-style hash noise — small and fast
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f*f*(3.0-2.0*f);
          float n = mix(mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x),
                            mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                            mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
          return n;
        }
        void main() {
          float speed = (u_state == 3.0) ? 1.2 : 0.35;
          float n = noise(position * 1.8 + u_time * speed);
          float amp = 0.10 + u_audio * 0.55;
          if (u_state == 2.0) amp = 0.18 + u_audio * 0.75; // speaking — bigger swells
          vec3 displaced = position + normal * n * amp;
          v_dist = n * amp;
          vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float u_state;
        varying float v_dist;
        void main() {
          vec3 cool = vec3(0.0, 0.78, 1.0);   // cyan
          vec3 warm = vec3(0.78, 0.66, 0.30); // gold
          vec3 col = (u_state == 2.0) ? mix(cool, warm, 0.35) : cool;
          float intensity = 0.55 + abs(v_dist) * 1.5;
          gl_FragColor = vec4(col * intensity, 0.9);
        }
      `,
    });
    const sphere = new THREE.Mesh(geom, sphereMat);
    scene.add(sphere);

    // ---- Inner glow (a back-side sphere with additive blending) ----
    const glowGeom = new THREE.IcosahedronGeometry(1.85, 4);
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { u_audio: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      vertexShader: /* glsl */`
        varying float v_d;
        void main() {
          v_d = dot(normalize(normal), vec3(0.0, 0.0, 1.0));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float u_audio;
        varying float v_d;
        void main() {
          float a = pow(1.0 - abs(v_d), 3.0) * (0.45 + u_audio * 0.5);
          gl_FragColor = vec4(0.0, 0.78, 1.0, a);
        }
      `,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    scene.add(glow);

    // ---- Particle field ----
    const PCOUNT = 1500;
    const positions = new Float32Array(PCOUNT * 3);
    const seeds = new Float32Array(PCOUNT);
    for (let i = 0; i < PCOUNT; i++) {
      const r = 2.0 + Math.random() * 1.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i*3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i*3+2] = r * Math.cos(phi);
      seeds[i] = Math.random();
    }
    const pGeom = new THREE.BufferGeometry();
    pGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pGeom.setAttribute("a_seed", new THREE.BufferAttribute(seeds, 1));
    const pMat = new THREE.ShaderMaterial({
      uniforms: { u_time: { value: 0 }, u_audio: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */`
        uniform float u_time;
        uniform float u_audio;
        attribute float a_seed;
        varying float v_seed;
        void main() {
          v_seed = a_seed;
          float spin = u_time * (0.2 + a_seed * 0.4);
          float c = cos(spin), s = sin(spin);
          vec3 p = position;
          // rotate around Y for orbit feel
          p = vec3(p.x*c - p.z*s, p.y, p.x*s + p.z*c);
          // breathing radius
          float r = 1.0 + u_audio * (0.15 + a_seed*0.4) * sin(u_time*2.0 + a_seed*6.28);
          p *= r;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.2 + a_seed * 2.4) * (1.0 + u_audio * 1.5);
        }
      `,
      fragmentShader: /* glsl */`
        varying float v_seed;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = (1.0 - d * 2.0);
          vec3 col = vec3(0.0, 0.78, 1.0);
          gl_FragColor = vec4(col, a * (0.4 + v_seed * 0.6));
        }
      `,
    });
    const particles = new THREE.Points(pGeom, pMat);
    scene.add(particles);

    // ---- Animation loop ----
    let raf = 0;
    const clock = new THREE.Clock();
    // smoothed audio
    let smoothed = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      // Smooth incoming audio so the sphere doesn't strobe
      const target = audioRef.current;
      smoothed += (target - smoothed) * 0.12;

      const stateMap = { idle: 0, listening: 1, speaking: 2, thinking: 3 };
      const stateVal = stateMap[stateRef.current] ?? 0;

      sphereUniforms.u_time.value = t;
      sphereUniforms.u_audio.value = smoothed;
      sphereUniforms.u_state.value = stateVal;
      glowMat.uniforms.u_audio.value = smoothed;
      pMat.uniforms.u_time.value = t;
      pMat.uniforms.u_audio.value = smoothed;

      const rot = stateVal === 3 ? 0.012 : 0.0025;
      sphere.rotation.y += rot;
      sphere.rotation.x += rot * 0.4;
      glow.rotation.copy(sphere.rotation);
      particles.rotation.y -= rot * 0.5;

      renderer.render(scene, camera);
    };
    tick();

    // ---- Resize ----
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      sphereMat.dispose();
      glowMat.dispose();
      pMat.dispose();
      geom.dispose();
      glowGeom.dispose();
      pGeom.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  return <div id="sphere-canvas" ref={containerRef} />;
}
