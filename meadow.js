/* PocketDex Meadow: a quiet 3D place where your caught Pokemon wander (Sansa / Jeda spirit).
   Classic script, needs window.THREE (vendor/three.min.js) and window.SPRITE_DATA (vendor/sprites-data.js). */
(function () {
  "use strict";

  const SKIES = {
    dawn: { top: "#f3d9c4", bottom: "#f7eadb", fog: 0xf5e6d6, hemi: 0xffe2c8, sun: 0xffd2a6, sunI: 1.0, ground: 0xb7c98c },
    day: { top: "#cfe0e8", bottom: "#f3efe4", fog: 0xeef0e6, hemi: 0xffffff, sun: 0xfff3dc, sunI: 1.25, ground: 0xb4cc86 },
    dusk: { top: "#e9b99a", bottom: "#f4dcc2", fog: 0xefd2b8, hemi: 0xffd7b5, sun: 0xffb07a, sunI: 0.95, ground: 0xa9bd7e },
    night: { top: "#18263a", bottom: "#2c3d52", fog: 0x2a3a4e, hemi: 0x8fa6c4, sun: 0xb9c8e6, sunI: 0.45, ground: 0x5f7756 },
  };

  function phaseFor(date) {
    const hour = date.getHours() + date.getMinutes() / 60;
    if (hour >= 5 && hour < 8) return "dawn";
    if (hour >= 8 && hour < 17) return "day";
    if (hour >= 17 && hour < 19.5) return "dusk";
    return "night";
  }

  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function blobTexture(THREE) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, "rgba(30,25,15,0.38)");
    gradient.addColorStop(1, "rgba(30,25,15,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  function glowTexture(THREE) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,240,180,1)");
    gradient.addColorStop(0.4, "rgba(255,225,140,0.5)");
    gradient.addColorStop(1, "rgba(255,220,120,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(canvas);
  }

  function webglAvailable() {
    try {
      const canvas = document.createElement("canvas");
      return Boolean(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
    } catch (error) {
      return false;
    }
  }

  function mount(container, options) {
    const THREE = window.THREE;
    const opts = Object.assign({ creatures: [], onSelect: null, compact: false, reduceMotion: false }, options || {});
    const phase = opts.phase || phaseFor(new Date());
    const sky = SKIES[phase];
    container.classList.add("meadow-stage");
    container.dataset.phase = phase;
    container.style.setProperty("--sky-top", sky.top);
    container.style.setProperty("--sky-bottom", sky.bottom);

    if (!THREE || !webglAvailable()) {
      container.innerHTML = '<p class="meadow-fallback">The meadow needs WebGL, which this browser has turned off. Everything else in PocketDex works.</p>';
      container.dataset.ready = "fallback";
      return { destroy() {} };
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.compact ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = "meadow-canvas";
    renderer.domElement.setAttribute("aria-label", "3D meadow with your Pokemon. Drag to look around, tap a Pokemon to see it.");
    renderer.domElement.setAttribute("role", "img");
    container.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(sky.fog, 18, 42);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

    scene.add(new THREE.HemisphereLight(sky.hemi, sky.ground, phase === "night" ? 0.7 : 1.05));
    const sun = new THREE.DirectionalLight(sky.sun, sky.sunI);
    sun.position.set(8, 14, 6);
    scene.add(sun);

    const random = seeded(2501);
    const disposables = [];
    function keep(object) {
      disposables.push(object);
      return object;
    }

    // ground: a soft round meadow that fades into fog
    const groundMat = keep(new THREE.MeshLambertMaterial({ color: sky.ground }));
    const ground = new THREE.Mesh(keep(new THREE.CircleGeometry(34, 64)), groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const pathMat = keep(new THREE.MeshLambertMaterial({ color: phase === "night" ? 0x6f6a55 : 0xd9c9a3 }));
    const path = new THREE.Mesh(keep(new THREE.RingGeometry(6.2, 7.1, 64)), pathMat);
    path.rotation.x = -Math.PI / 2;
    path.position.y = 0.01;
    scene.add(path);

    // pond
    const pondMat = keep(new THREE.MeshLambertMaterial({ color: phase === "night" ? 0x35506a : 0x9cc6c8, transparent: true, opacity: 0.92 }));
    const pond = new THREE.Mesh(keep(new THREE.CircleGeometry(2.3, 40)), pondMat);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(-4.2, 0.02, -3.2);
    scene.add(pond);
    const stoneGeo = keep(new THREE.DodecahedronGeometry(0.28, 0));
    const stoneMat = keep(new THREE.MeshLambertMaterial({ color: 0xbdb4a2, flatShading: true }));
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      stone.position.set(-4.2 + Math.cos(angle) * 2.5, 0.1, -3.2 + Math.sin(angle) * 2.5);
      stone.scale.setScalar(0.7 + random() * 0.6);
      stone.rotation.set(random() * 3, random() * 3, 0);
      scene.add(stone);
    }

    // trees around the edge
    const trunkGeo = keep(new THREE.CylinderGeometry(0.14, 0.2, 1.3, 7));
    const trunkMat = keep(new THREE.MeshLambertMaterial({ color: 0x8a6a4c }));
    const leafGeo = keep(new THREE.IcosahedronGeometry(1, 0));
    const leafColors = phase === "night" ? [0x3f5a45, 0x4a6550] : [0x7ea566, 0x8db271, 0x6f9a5d];
    const leafMats = leafColors.map((color) => keep(new THREE.MeshLambertMaterial({ color, flatShading: true })));
    const trees = [];
    for (let i = 0; i < 11; i++) {
      const angle = (i / 11) * Math.PI * 2 + random() * 0.3;
      const radius = 11 + random() * 3.5;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.65;
      tree.add(trunk);
      const crown = new THREE.Mesh(leafGeo, leafMats[i % leafMats.length]);
      crown.position.y = 1.9;
      crown.scale.set(1.2, 1.35, 1.2);
      tree.add(crown);
      tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      tree.scale.setScalar(0.85 + random() * 0.6);
      scene.add(tree);
      trees.push(crown);
    }

    // grass tufts (one instanced mesh)
    const tuftGeo = keep(new THREE.ConeGeometry(0.07, 0.38, 4));
    const tuftMat = keep(new THREE.MeshLambertMaterial({ color: phase === "night" ? 0x4f6b47 : 0x93b36c }));
    const tuftCount = opts.compact ? 260 : 520;
    const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < tuftCount; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 1.5 + Math.sqrt(random()) * 12;
      dummy.position.set(Math.cos(angle) * radius, 0.15, Math.sin(angle) * radius);
      dummy.rotation.set((random() - 0.5) * 0.4, random() * 3, (random() - 0.5) * 0.4);
      dummy.scale.setScalar(0.7 + random() * 0.8);
      dummy.updateMatrix();
      tufts.setMatrixAt(i, dummy.matrix);
    }
    scene.add(tufts);

    // flowers: a few warm dots
    const flowerGeo = keep(new THREE.SphereGeometry(0.07, 6, 6));
    const flowerMats = [0xf2c14e, 0xf4f1e8, 0xe8836f].map((color) => keep(new THREE.MeshLambertMaterial({ color })));
    for (let i = 0; i < 70; i++) {
      const angle = random() * Math.PI * 2;
      const radius = 2 + Math.sqrt(random()) * 11;
      const flower = new THREE.Mesh(flowerGeo, flowerMats[i % 3]);
      flower.position.set(Math.cos(angle) * radius, 0.22, Math.sin(angle) * radius);
      scene.add(flower);
    }

    // fireflies at night, drifting petals otherwise
    let motes = null;
    const moteCount = phase === "night" ? 60 : 24;
    const motePositions = new Float32Array(moteCount * 3);
    const moteSeeds = [];
    for (let i = 0; i < moteCount; i++) {
      motePositions[i * 3] = (random() - 0.5) * 22;
      motePositions[i * 3 + 1] = 0.6 + random() * 2.6;
      motePositions[i * 3 + 2] = (random() - 0.5) * 22;
      moteSeeds.push(random() * 10);
    }
    const moteGeo = keep(new THREE.BufferGeometry());
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
    const moteTex = keep(glowTexture(THREE));
    const moteMat = keep(new THREE.PointsMaterial({
      size: phase === "night" ? 0.32 : 0.16,
      map: moteTex,
      transparent: true,
      depthWrite: false,
      opacity: phase === "night" ? 0.95 : 0.45,
      blending: phase === "night" ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

    // ambient life: clouds by day, butterflies in daylight, ripples on the pond
    const ambientRand = seeded(7331);
    const cloudRig = new THREE.Group();
    if (phase !== "night") {
      const cloudGeo = keep(new THREE.IcosahedronGeometry(1, 0));
      const cloudMat = keep(new THREE.MeshBasicMaterial({
        color: phase === "day" ? 0xffffff : 0xfdeee2,
        transparent: true,
        opacity: 0.9,
        fog: false,
      }));
      const cloudCount = opts.compact ? 4 : 6;
      for (let i = 0; i < cloudCount; i++) {
        const cloud = new THREE.Group();
        const puffs = 3 + Math.floor(ambientRand() * 2);
        for (let p = 0; p < puffs; p++) {
          const puff = new THREE.Mesh(cloudGeo, cloudMat);
          puff.position.set((p - puffs / 2) * 1.1, ambientRand() * 0.35, (ambientRand() - 0.5) * 0.6);
          puff.scale.set(1.2 + ambientRand() * 0.5, 0.42 + ambientRand() * 0.12, 0.8);
          cloud.add(puff);
        }
        const angle = (i / cloudCount) * Math.PI * 2 + ambientRand() * 0.6;
        const radius = 21 + ambientRand() * 5;
        cloud.position.set(Math.cos(angle) * radius, 4.3 + ambientRand() * 1.1, Math.sin(angle) * radius);
        cloud.rotation.y = ambientRand() * Math.PI;
        cloudRig.add(cloud);
      }
    }
    scene.add(cloudRig);

    const butterflies = [];
    const butterflyCount = phase === "night" ? 0 : phase === "day" ? (opts.compact ? 3 : 5) : 2;
    if (butterflyCount) {
      const wingGeo = keep(new THREE.PlaneGeometry(0.2, 0.15));
      wingGeo.translate(0.1, 0, 0);
      const wingMats = [0xf2c14e, 0xf4f1e8, 0xe8836f].map((color) =>
        keep(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))
      );
      for (let i = 0; i < butterflyCount; i++) {
        const body = new THREE.Group();
        const left = new THREE.Mesh(wingGeo, wingMats[i % wingMats.length]);
        const right = new THREE.Mesh(wingGeo, wingMats[i % wingMats.length]);
        right.rotation.z = Math.PI;
        body.add(left, right);
        const angle = ambientRand() * Math.PI * 2;
        const ring = 2.5 + ambientRand() * 6;
        butterflies.push({
          body,
          left,
          right,
          center: new THREE.Vector3(Math.cos(angle) * ring, 0, Math.sin(angle) * ring),
          reach: 1.4 + ambientRand() * 1.6,
          speed: 0.25 + ambientRand() * 0.25,
          seed: ambientRand() * 10,
        });
        scene.add(body);
      }
    }

    const ripples = [];
    const rippleGeo = keep(new THREE.RingGeometry(0.42, 0.48, 40));
    for (let i = 0; i < 3; i++) {
      const rippleMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      const ripple = new THREE.Mesh(rippleGeo, rippleMat);
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.set(-4.2 + (ambientRand() - 0.5) * 2, 0.035, -3.2 + (ambientRand() - 0.5) * 2);
      ripples.push({ mesh: ripple, offset: i / 3, base: ripple.position.clone() });
      scene.add(ripple);
    }
    function placeAmbient(t) {
      cloudRig.rotation.y = t * 0.008;
      butterflies.forEach((b) => {
        const u = t * b.speed + b.seed;
        const x = b.center.x + Math.sin(u) * b.reach;
        const z = b.center.z + Math.sin(u * 2) * b.reach * 0.6;
        const dx = Math.cos(u) * b.reach;
        const dz = Math.cos(u * 2) * b.reach * 1.2;
        b.body.position.set(x, 0.85 + Math.sin(u * 3) * 0.25, z);
        b.body.rotation.y = Math.atan2(-dz, dx);
        const flap = Math.sin(t * 16 + b.seed) * 1.1;
        b.left.rotation.y = flap;
        b.right.rotation.y = -flap;
      });
      ripples.forEach((r) => {
        const cycle = (t / 4.5 + r.offset) % 1;
        if (cycle < 0.02) {
          r.mesh.position.set(r.base.x + (Math.sin(t * 7.1 + r.offset * 9) * 0.8), 0.035, r.base.z + Math.cos(t * 5.3 + r.offset * 7) * 0.8);
        }
        r.mesh.scale.setScalar(0.3 + cycle * 2.4);
        r.mesh.material.opacity = (1 - cycle) * (phase === "night" ? 0.25 : 0.55);
      });
    }
    placeAmbient(3);

    // creatures as pixel billboards with blob shadows
    const shadowTex = keep(blobTexture(THREE));
    const shadowGeo = keep(new THREE.PlaneGeometry(1.3, 1.3));
    const shadowMat = keep(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    const creatures = [];
    const loader = new THREE.TextureLoader();
    function spriteSource(id) {
      const data = window.SPRITE_DATA && window.SPRITE_DATA[id];
      return data ? "data:image/png;base64," + data : "sprites/" + id + ".png";
    }
    // The compact Today view keeps everyone inside a 7.5 m ring so no sprite is cut by the frame.
    const wanderRadius = opts.compact ? 7.5 : 9.5;
    function freeSpot(rand) {
      for (let tries = 0; tries < 30; tries++) {
        const angle = rand() * Math.PI * 2;
        const radius = 1.2 + Math.sqrt(rand()) * (wanderRadius - 1.2);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (Math.hypot(x + 4.2, z + 3.2) > 3.1) return new THREE.Vector3(x, 0, z);
      }
      return new THREE.Vector3(2, 0, 2);
    }
    let pending = opts.creatures.length;
    function maybeReady() {
      if (pending <= 0) container.dataset.loaded = "1";
    }
    opts.creatures.forEach((info, index) => {
      const rand = seeded(info.id * 31 + index);
      const material = new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.35 });
      const sprite = new THREE.Sprite(material);
      const size = info.partner ? 2.3 : info.encounter ? 2.1 : 1.9;
      sprite.scale.set(size, size, 1);
      sprite.userData = { id: info.id };
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      const start = info.partner ? new THREE.Vector3(1.4, 0, 2.2) : info.encounter ? new THREE.Vector3(3.6, 0, -1.4) : freeSpot(rand);
      const creature = {
        info,
        sprite,
        shadow,
        size,
        position: start.clone(),
        target: start.clone(),
        wait: rand() * 3,
        speed: 0.55 + rand() * 0.35,
        phase: rand() * 6,
        facing: 1,
        rand,
      };
      sprite.position.set(start.x, size * 0.42, start.z);
      shadow.position.x = start.x;
      shadow.position.z = start.z;
      scene.add(sprite);
      scene.add(shadow);
      creatures.push(creature);
      loader.load(
        spriteSource(info.id),
        (texture) => {
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.generateMipmaps = false;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          material.map = texture;
          material.needsUpdate = true;
          keep(texture);
          pending -= 1;
          maybeReady();
        },
        undefined,
        () => {
          pending -= 1;
          maybeReady();
        }
      );
      keep(material);
    });
    maybeReady();

    // camera orbit: drag to turn, wheel or pinch to zoom, slow drift when idle
    const view = { azimuth: 0.6, elevation: opts.compact ? 0.5 : 0.38, radius: opts.compact ? 21 : 15.5, target: new THREE.Vector3(0, 0.6, 0) };
    let dragging = false;
    let dragStart = null;
    let lastPointer = null;
    let idleSince = performance.now();
    const pointers = new Map();
    let pinchStart = 0;
    let radiusStart = view.radius;
    const canvas = renderer.domElement;

    function onPointerDown(event) {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        radiusStart = view.radius;
      }
      dragging = true;
      dragStart = { x: event.clientX, y: event.clientY };
      lastPointer = { x: event.clientX, y: event.clientY };
      idleSince = performance.now();
    }
    function onPointerMove(event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart > 0) view.radius = Math.min(24, Math.max(8, radiusStart * (pinchStart / distance)));
        return;
      }
      if (!dragging) return;
      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      lastPointer = { x: event.clientX, y: event.clientY };
      view.azimuth -= dx * 0.006;
      view.elevation = Math.min(0.95, Math.max(0.16, view.elevation + dy * 0.004));
      idleSince = performance.now();
    }
    const raycaster = new THREE.Raycaster();
    function onPointerUp(event) {
      pointers.delete(event.pointerId);
      if (!dragging) return;
      dragging = false;
      const moved = dragStart ? Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) : 99;
      if (moved < 6 && opts.onSelect) {
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(creatures.map((c) => c.sprite));
        if (hits.length) opts.onSelect(hits[0].object.userData.id);
      }
    }
    function onWheel(event) {
      event.preventDefault();
      view.radius = Math.min(24, Math.max(8, view.radius + event.deltaY * 0.01));
      idleSince = performance.now();
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    function resize() {
      const width = container.clientWidth || 300;
      const height = container.clientHeight || 240;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    const resizeObserver = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (resizeObserver) resizeObserver.observe(container);
    resize();

    let visible = true;
    const intersection = window.IntersectionObserver
      ? new IntersectionObserver((entries) => {
          visible = entries[0].isIntersecting;
        })
      : null;
    if (intersection) intersection.observe(container);

    let running = true;
    let frame = 0;
    let last = performance.now();
    let elapsed = 0;
    // The small Today preview runs at about 30 fps; the full Meadow page at display rate.
    const minFrameMs = opts.compact ? 32 : 0;
    function step(now) {
      if (!running) return;
      frame = requestAnimationFrame(step);
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      if (now - last < minFrameMs) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try {
        elapsed += dt;
        if (!opts.reduceMotion && !dragging && now - idleSince > 2500) view.azimuth += dt * 0.035;
        camera.position.set(
          view.target.x + Math.cos(view.azimuth) * Math.cos(view.elevation) * view.radius,
          view.target.y + Math.sin(view.elevation) * view.radius,
          view.target.z + Math.sin(view.azimuth) * Math.cos(view.elevation) * view.radius
        );
        camera.lookAt(view.target);

        creatures.forEach((c) => {
          if (opts.reduceMotion) {
            c.sprite.position.set(c.position.x, c.size * 0.42, c.position.z);
            return;
          }
          const toTarget = c.target.clone().sub(c.position);
          const distance = toTarget.length();
          let moving = false;
          if (c.wait > 0) {
            c.wait -= dt;
            if (c.sprite.material.map && c.rand() < dt * 0.18) {
              c.facing = -(c.facing || 1);
              c.sprite.material.map.repeat.x = c.facing;
              c.sprite.material.map.offset.x = c.facing === -1 ? 1 : 0;
            }
          } else if (distance < 0.08) {
            c.wait = 2 + c.rand() * 5;
            c.joy = c.rand() < 0.35 ? 0.6 : 0;
            if (c.info.encounter) {
              c.target.set(3.6 + (c.rand() - 0.5) * 1.6, 0, -1.4 + (c.rand() - 0.5) * 1.6);
            } else if (c.info.partner) {
              c.target.set(1.4 + (c.rand() - 0.5) * 3, 0, 2.2 + (c.rand() - 0.5) * 3);
            } else {
              const angle = c.rand() * Math.PI * 2;
              const reach = 1.5 + c.rand() * 3;
              const next = new THREE.Vector3(c.position.x + Math.cos(angle) * reach, 0, c.position.z + Math.sin(angle) * reach);
              if (next.length() < wanderRadius && Math.hypot(next.x + 4.2, next.z + 3.2) > 3.1) c.target.copy(next);
            }
          } else {
            moving = true;
            toTarget.normalize().multiplyScalar(Math.min(distance, c.speed * dt));
            c.position.add(toTarget);
            // face the direction of travel relative to the camera
            const screenRight = new THREE.Vector3(-Math.sin(view.azimuth), 0, Math.cos(view.azimuth));
            const facing = toTarget.dot(screenRight) >= 0 ? -1 : 1;
            if (c.sprite.material.map && facing !== c.facing) {
              c.facing = facing;
              c.sprite.material.map.repeat.x = facing;
              c.sprite.material.map.offset.x = facing === -1 ? 1 : 0;
            }
          }
          let hop = moving ? Math.abs(Math.sin(elapsed * 9 + c.phase)) * 0.14 : Math.sin(elapsed * 2 + c.phase) * 0.025;
          if (!moving && c.joy > 0) {
            c.joy = Math.max(0, c.joy - dt);
            hop = Math.abs(Math.sin(((0.6 - c.joy) / 0.3) * Math.PI)) * 0.24;
          }
          c.sprite.position.set(c.position.x, c.size * 0.42 + hop, c.position.z);
          c.shadow.position.set(c.position.x, 0.02, c.position.z);
          c.shadow.scale.setScalar(c.size * 0.55 * (1 - hop * 0.8));
        });

        if (!opts.reduceMotion) {
          const positions = moteGeo.attributes.position.array;
          for (let i = 0; i < moteCount; i++) {
            positions[i * 3 + 1] += Math.sin(elapsed * 0.8 + moteSeeds[i]) * 0.004;
            positions[i * 3] += Math.cos(elapsed * 0.3 + moteSeeds[i]) * 0.003;
          }
          moteGeo.attributes.position.needsUpdate = true;
          trees.forEach((crown, i) => {
            crown.rotation.z = Math.sin(elapsed * 0.6 + i) * 0.03;
          });
          placeAmbient(elapsed + 3);
        }
        renderer.render(scene, camera);
        if (!container.dataset.ready) container.dataset.ready = "1";
      } catch (error) {
        container.dataset.error = String(error && error.message);
      }
    }
    frame = requestAnimationFrame(step);

    return {
      phase,
      destroy() {
        running = false;
        cancelAnimationFrame(frame);
        if (resizeObserver) resizeObserver.disconnect();
        if (intersection) intersection.disconnect();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.removeEventListener("wheel", onWheel);
        disposables.forEach((item) => item && item.dispose && item.dispose());
        tufts.dispose();
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        canvas.remove();
      },
    };
  }

  window.PocketMeadow = { mount, phaseFor };
})();
