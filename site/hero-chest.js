const hero = document.querySelector('.hero');
const art = hero?.querySelector('.hero-art');
const canvas = hero?.querySelector('.hero-canvas');
const desktopScene = matchMedia('(min-width: 701px)');
let started = false;

async function startChest() {
  if (!hero || !art || !canvas || started) return;
  started = true;

  try {
    const [THREE, { GLTFLoader }] = await Promise.all([
      import('./vendor/three.module.js'),
      import('./vendor/loaders/GLTFLoader.js'),
    ]);
    const gltf = await new GLTFLoader().loadAsync('/assets/ender-chest.gltf');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0x101b1c, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 100);
    camera.position.set(7, 5.3, 9);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 2.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(-3, 8, 8);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x96d1bb, 1.1);
    fill.position.set(5, 2, -6);
    scene.add(fill);

    const chest = new THREE.Group();
    const model = gltf.scene;
    chest.add(model);
    scene.add(chest);
    const meshes = [];
    model.traverse(object => {
      if (!object.isMesh) return;
      meshes.push(object);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material.map) continue;
        material.map.magFilter = THREE.NearestFilter;
        material.map.minFilter = THREE.NearestFilter;
        material.map.needsUpdate = true;
      }
    });

    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const modelScale = 3.45 / Math.max(size.x, size.z);
    model.scale.setScalar(modelScale);
    model.position.set(-center.x * modelScale, -center.y * modelScale, -center.z * modelScale);

    const folderFace = new THREE.MeshStandardMaterial({ color: 0xebc45a, roughness: 1, side: THREE.DoubleSide });
    const folderDetail = new THREE.MeshStandardMaterial({ color: 0xffdd7c, roughness: 1, side: THREE.DoubleSide });
    const folderEdge = new THREE.MeshStandardMaterial({ color: 0x6b5427, roughness: 1, side: THREE.DoubleSide });
    const folderShape = new THREE.Shape();
    folderShape.moveTo(-0.48, -0.27);
    folderShape.lineTo(0.48, -0.27);
    folderShape.lineTo(0.48, 0.17);
    folderShape.lineTo(-0.04, 0.17);
    folderShape.lineTo(-0.15, 0.29);
    folderShape.lineTo(-0.48, 0.29);
    folderShape.closePath();
    const folderGeometry = new THREE.ShapeGeometry(folderShape);
    const folders = [
      { x: -0.53, z: -0.18, delay: 0, angle: 0.52 },
      { x: 0.52, z: 0.26, delay: 0.1, angle: 0.72 },
    ].map(({ x, z, delay, angle }) => {
      const folder = new THREE.Group();
      const edge = new THREE.Mesh(folderGeometry, folderEdge);
      edge.scale.set(1.09, 1.13, 1);
      folder.add(edge);
      const face = new THREE.Mesh(folderGeometry, folderFace);
      face.position.z = 0.02;
      folder.add(face);
      const lip = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.09), folderDetail);
      lip.position.set(0, 0.08, 0.03);
      folder.add(lip);
      folder.position.set(x, 0.4, z);
      folder.rotation.y = angle;
      folder.visible = false;
      chest.add(folder);
      return { folder, delay };
    });

    const lid = model.getObjectByName('Lid');
    const lidTrack = gltf.animations[0]?.tracks.find(track => track.name.endsWith('Lid.quaternion'));
    if (!lid || !lidTrack) throw new Error('The supplied chest lid animation is missing');
    const closed = lid.quaternion.clone();
    const open = new THREE.Quaternion().fromArray(lidTrack.values, 8);
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let hovered = false;
    let pinned = false;
    let visible = true;

    function resize() {
      const width = Math.max(1, Math.round(hero.clientWidth));
      const height = Math.max(1, Math.round(hero.clientHeight));
      renderer.setSize(width, height, false);
      const viewHeight = width <= 900 ? 6.2 : 5.9;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.left = -viewHeight * width / height / 2;
      camera.right = viewHeight * width / height / 2;
      camera.updateProjectionMatrix();
      chest.scale.setScalar(width <= 760 ? 0.52 : width <= 1000 ? 0.63 : 0.75);
      const chestX = width <= 760 ? 2.35 : width <= 900 ? 2.0 : width <= 1000 ? 2.6 : Math.min(4.23, 2.88 + (width - 1000) * 0.003);
      chest.position.set(chestX, width <= 900 ? -0.25 : 0.4 + Math.max(0, chestX - 3.35) * 0.35, 0);
    }

    function hit(event) {
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(meshes, false).length > 0;
    }

    hero.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch' || !desktopScene.matches) return;
      hovered = hit(event);
      hero.dataset.chestHover = String(hovered);
    });
    hero.addEventListener('pointerleave', () => {
      hovered = false;
      hero.dataset.chestHover = 'false';
    });
    hero.addEventListener('click', event => {
      if (!desktopScene.matches || event.target.closest('a, button') || !hit(event)) return;
      pinned = !pinned;
      hero.dataset.chestOpen = String(pinned);
    });

    new ResizeObserver(resize).observe(hero);
    new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; }).observe(hero);
    resize();

    function frame(time) {
      requestAnimationFrame(frame);
      if (!visible || !desktopScene.matches) return;
      const target = hovered || pinned ? 0.5 : 0;
      const current = lid.userData.openness ?? 0;
      const openness = reducedMotion.matches ? target : THREE.MathUtils.lerp(current, target, 0.12);
      lid.userData.openness = openness;
      hero.dataset.chestOpenness = openness.toFixed(2);
      lid.quaternion.slerpQuaternions(closed, open, openness);
      for (const { folder, delay } of folders) {
        const rise = THREE.MathUtils.smoothstep(openness, 0.09 + delay, 0.43 + delay);
        folder.visible = rise > 0.02;
        folder.position.y = 0.4 + rise * 0.86;
        folder.scale.setScalar(0.72 + rise * 0.28);
      }
      hero.dataset.folderLift = THREE.MathUtils.smoothstep(openness, 0.09, 0.43).toFixed(2);
      chest.rotation.y = reducedMotion.matches ? 0 : Math.sin(time * 0.0003) * 0.018;
      renderer.render(scene, camera);
      hero.dataset.chestReady = 'true';
    }
    requestAnimationFrame(frame);
  } catch (error) {
    art.classList.add('is-fallback');
    hero.dataset.chestReady = 'fallback';
    console.warn('EnderChest 3D preview unavailable', error);
  }
}

if (hero) {
  hero.dataset.chestMode = desktopScene.matches ? 'interactive' : 'static';
  if (desktopScene.matches) startChest();
  desktopScene.addEventListener('change', event => {
    hero.dataset.chestMode = event.matches ? 'interactive' : 'static';
    if (event.matches) startChest();
  });
}
