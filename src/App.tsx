import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- 动态生成照片列表 ---
const TOTAL_NUMBERED_PHOTOS = 31;
const bodyPhotoPaths = [
  '/photos/top.jpg',
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `/photos/${i + 1}.jpg`)
];

// --- 视觉配置 ---
const CONFIG = {
  colors: {
    emerald: '#004225',
    gold: '#FFD700',
    silver: '#ECEFF1',
    red: '#D32F2F',
    green: '#2E7D32',
    white: '#FFFFFF',
    warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'],
    borders: ['#FFFAF0', '#F0E68C', '#E6E6FA', '#FFB6C1', '#98FB98', '#87CEFA', '#FFDAB9'],
    giftColors: ['#B71C1C', '#1A237E', '#004D40', '#F57F17', '#4A148C'], 
    ribbonColors: ['#FFD700', '#C0C0C0', '#FFFFFF']
  },
  counts: {
    foliage: 7000,    
    ornaments: 200,   
    elements: 150,
    lights: 300
  },
  tree: { height: 32, radius: 12 }, 
  photos: {
    body: bodyPhotoPaths
  }
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h/2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i*3] = spherePoints[i*3]; positions[i*3+1] = spherePoints[i*3+1]; positions[i*3+2] = spherePoints[i*3+2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i*3] = tx; targetPositions[i*3+1] = ty; targetPositions[i*3+2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Component: Photo Ornaments ---
const PhotoOrnaments = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const textures = useTexture(CONFIG.photos.body);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);
  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*70, (Math.random()-0.5)*70, (Math.random()-0.5)*70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor = CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)];
      return {
        chaosPos, targetPos, scale: baseScale, weight,
        textureIndex: i % textures.length, borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI),
        rotationSpeed: { x: (Math.random()-0.5), y: (Math.random()-0.5), z: (Math.random()-0.5) }
      };
    });
  }, [textures, count]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * (isFormed ? 0.8 * objData.weight : 0.5));
      group.position.copy(objData.currentPos);
      if (isFormed) {
         group.lookAt(new THREE.Vector3(group.position.x * 2, group.position.y, group.position.z * 2));
      } else {
         group.rotation.x += delta * objData.rotationSpeed.x;
         group.rotation.y += delta * objData.rotationSpeed.y;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} scale={[obj.scale, obj.scale, obj.scale]} rotation={state === 'CHAOS' ? obj.chaosRotation : [0,0,0]}>
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial map={textures[obj.textureIndex]} roughness={0.5} emissive={CONFIG.colors.white} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={1.0} side={THREE.FrontSide} />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} side={THREE.FrontSide} />
            </mesh>
          </group>
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
             <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} side={THREE.FrontSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Component: Christmas Elements (Candy & Ornaments) ---
const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);
  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const type = Math.random() > 0.5 ? 0 : 1; // 0 box, 1 sphere
      const color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)];
      return { type, chaosPos, targetPos, color, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random(), 0) };
    });
  }, [boxGeometry, sphereGeometry]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((mesh, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      if(!isFormed) mesh.rotation.x += delta;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <mesh key={i} geometry={obj.type === 0 ? boxGeometry : sphereGeometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.6} emissive={obj.color} emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);
  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      return { chaosPos, targetPos, color, speed: 2 + Math.random()*3, currentPos: chaosPos.clone(), timeOffset: Math.random()*100 };
    });
  }, []);
  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) { (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed ? 3 + intensity * 4 : 0; }
    });
  });
  return (
    <group ref={groupRef}>
      {data.map((obj, i) => ( <mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
        </mesh> ))}
    </group>
  );
};

// --- Component: Top Star ---
const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);
  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3; const innerRadius = 0.7; const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(radius*Math.cos(angle), radius*Math.sin(angle)) : shape.lineTo(radius*Math.cos(angle), radius*Math.sin(angle));
    }
    shape.closePath(); return shape;
  }, []);
  const starGeometry = useMemo(() => new THREE.ExtrudeGeometry(starShape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3 }), [starShape]);
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      const targetScale = state === 'FORMED' ? 1 : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3);
    }
  });
  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry}>
           <meshStandardMaterial color={CONFIG.colors.gold} emissive={CONFIG.colors.gold} emissiveIntensity={1.5} roughness={0.1} metalness={1.0} />
        </mesh>
      </Float>
    </group>
  );
};

// --- 新增：树下的礼物盒堆 (Ground Gifts) ---
const GroundGifts = ({ state, treeRadius }: { state: 'CHAOS' | 'FORMED', treeRadius: number }) => {
  const count = 15; // 每棵树下放 15 个礼物
  const groupRef = useRef<THREE.Group>(null);
  const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  
  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      // 随机分布在树根周围
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * (treeRadius * 0.8); // 散落在树底范围内
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      
      const scale = 1.5 + Math.random() * 2.0; // 大小不一
      const y = -CONFIG.tree.height / 2 + (scale * 0.5); // 放在地上
      
      const color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)];
      const ribbonColor = CONFIG.colors.ribbonColors[Math.floor(Math.random() * CONFIG.colors.ribbonColors.length)];
      
      const rotation = new THREE.Euler(0, Math.random() * Math.PI, 0);
      
      return { pos: [x, y, z], scale, color, ribbonColor, rotation };
    });
  }, [treeRadius]);

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} position={obj.pos as [number, number, number]} rotation={obj.rotation} scale={state === 'FORMED' ? obj.scale : 0}>
           {/* 礼物盒子 */}
           <mesh geometry={boxGeo}>
             <meshStandardMaterial color={obj.color} roughness={0.4} metalness={0.2} />
           </mesh>
           {/* 丝带 (横竖两根) */}
           <mesh position={[0, 0, 0]} scale={[1.02, 1.02, 0.2]}>
              <boxGeometry />
              <meshStandardMaterial color={obj.ribbonColor} roughness={0.2} metalness={0.5} />
           </mesh>
           <mesh position={[0, 0, 0]} scale={[0.2, 1.02, 1.02]}>
              <boxGeometry />
              <meshStandardMaterial color={obj.ribbonColor} roughness={0.2} metalness={0.5} />
           </mesh>
        </group>
      ))}
    </group>
  );
};

// --- 新增：极简玩具圣诞老人 (Toy Santa) ---
const ToySanta = ({ state, position }: { state: 'CHAOS' | 'FORMED', position: [number, number, number] }) => {
  const groupRef = useRef<THREE.Group>(null);
  
  // 修改：将参数名改为 _stateObj，或者直接解构出 clock
  useFrame((_stateObj) => {
     if(groupRef.current && state === 'FORMED') {
         // 让圣诞老人轻轻摇晃，像是不倒翁
         // 注意：这里我们确实用到了它！如果你的编辑器还报错，可能是误报，但加上下划线 _stateObj 通常能解决
         const t = _stateObj.clock.elapsedTime; 
         groupRef.current.rotation.z = Math.sin(t * 2) * 0.1;
         groupRef.current.rotation.y = Math.sin(t * 1) * 0.1;
     }
  });

  // ... (下面的 return 内容保持不变) ...
  // 为节省篇幅，这里省略 return 部分，你只需要替换上面的 useFrame 部分即可
  // 如果你想替换整个 ToySanta 组件，请看下面：
  
  const matRed = new THREE.MeshStandardMaterial({ color: '#D32F2F', roughness: 0.3 });
  const matWhite = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.8 });
  const matFace = new THREE.MeshStandardMaterial({ color: '#FFCCBC', roughness: 0.5 });
  const matBlack = new THREE.MeshStandardMaterial({ color: '#222222', roughness: 0.5 });

  return (
    <group ref={groupRef} position={position} scale={state === 'FORMED' ? 1.5 : 0}>
      <mesh position={[0, 2.5, 0]}>
         <cylinderGeometry args={[1.5, 2, 3, 16]} />
         <primitive object={matRed} attach="material" />
      </mesh>
      <mesh position={[-0.8, 0.5, 0]}>
         <cylinderGeometry args={[0.6, 0.6, 1.5, 16]} />
         <primitive object={matRed} attach="material" />
      </mesh>
      <mesh position={[0.8, 0.5, 0]}>
         <cylinderGeometry args={[0.6, 0.6, 1.5, 16]} />
         <primitive object={matRed} attach="material" />
      </mesh>
      <mesh position={[-0.8, -0.5, 0.2]}>
         <boxGeometry args={[0.7, 0.5, 1]} />
         <primitive object={matBlack} attach="material" />
      </mesh>
      <mesh position={[0.8, -0.5, 0.2]}>
         <boxGeometry args={[0.7, 0.5, 1]} />
         <primitive object={matBlack} attach="material" />
      </mesh>
      <mesh position={[0, 4.5, 0]}>
         <sphereGeometry args={[1.2, 32, 32]} />
         <primitive object={matFace} attach="material" />
      </mesh>
      <mesh position={[0, 4.0, 0.8]}>
         <sphereGeometry args={[0.8, 16, 16]} />
         <primitive object={matWhite} attach="material" />
      </mesh>
      <mesh position={[0, 5.5, 0]} rotation={[0.2, 0, 0]}>
         <coneGeometry args={[1.3, 2.5, 32]} />
         <primitive object={matRed} attach="material" />
      </mesh>
      <group position={[1.8, 3.5, 0]} rotation={[0, 0, -0.5]}>
         <mesh>
            <capsuleGeometry args={[0.4, 1.5, 4, 8]} />
            <primitive object={matRed} attach="material" />
         </mesh>
         <mesh position={[0, 0.8, 0]}>
            <sphereGeometry args={[0.5]} />
            <primitive object={matWhite} attach="material" />
         </mesh>
      </group>
      <group position={[-1.8, 3.5, 0]} rotation={[0, 0, 0.5]}>
         <mesh>
            <capsuleGeometry args={[0.4, 1.5, 4, 8]} />
            <primitive object={matRed} attach="material" />
         </mesh>
         <mesh position={[0, 0.8, 0]}>
            <sphereGeometry args={[0.5]} />
            <primitive object={matWhite} attach="material" />
         </mesh>
      </group>
    </group>
  );
};

// --- 封装好的单棵树组件 ---
const TreeGroup = ({ state, position, scale = 1, showSanta = false }: { state: 'CHAOS' | 'FORMED', position: [number, number, number], scale?: number, showSanta?: boolean }) => {
  return (
    <group position={position} scale={[scale, scale, scale]}>
      <Foliage state={state} />
      {/* 树下的礼物 */}
      <GroundGifts state={state} treeRadius={CONFIG.tree.radius} />
      {/* 圣诞老人 (只在主树显示) */}
      {showSanta && <ToySanta state={state} position={[8, -CONFIG.tree.height/2 + 2, 5]} />}
      
      <Suspense fallback={null}>
        <PhotoOrnaments state={state} />
        <ChristmasElements state={state} />
        <FairyLights state={state} />
        <TopStar state={state} />
      </Suspense>
      <Sparkles count={Math.floor(200 * scale)} scale={50 * scale} size={6} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
    </group>
  );
};

// --- Main Scene Experience (3 Tree Layout) ---
const Experience = ({ sceneState, rotationSpeed }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number }) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });

  // 3 棵树布局 (品字形：主树在前，两棵在后)
  const forestLayout = [
    { pos: [0, -10, 0], scale: 1.0, santa: true },       // 主树
    { pos: [-25, -10, -15], scale: 0.7, santa: false },  // 左后
    { pos: [25, -10, -15], scale: 0.7, santa: false },   // 右后
  ];

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={20} maxDistance={150} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      {/* 渲染森林 */}
      {forestLayout.map((tree, index) => (
        <TreeGroup 
          key={index}
          state={sceneState} 
          position={tree.pos as [number, number, number]} 
          scale={tree.scale}
          showSanta={tree.santa}
        />
      ))}

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.2} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
const GestureController = ({ onGesture, onMove, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;
    const setup = async () => {
      onStatus("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            onStatus("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else { onStatus("ERROR: CAMERA PERMISSION DENIED"); }
      } catch (err: any) { onStatus(`ERROR: ${err.message || 'MODEL FAILED'}`); }
    };
    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
            const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");
            if (ctx && debugMode) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
                if (results.landmarks) for (const landmarks of results.landmarks) {
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
                }
            } else if (ctx && !debugMode) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

            if (results.gestures.length > 0) {
              const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
              if (score > 0.4) {
                 if (name === "Open_Palm") onGesture("CHAOS"); if (name === "Closed_Fist") onGesture("FORMED");
                 if (debugMode) onStatus(`DETECTED: ${name}`);
              }
              if (results.landmarks.length > 0) {
                const speed = (0.5 - results.landmarks[0][0].x) * 0.15;
                onMove(Math.abs(speed) > 0.01 ? speed : 0);
              }
            } else { onMove(0); if (debugMode) onStatus("AI READY: NO HAND"); }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onStatus, debugMode]);
  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};
// --- 新增：网络/VPN 提示遮罩层 ---
const NetworkWarning = ({ aiStatus }: { aiStatus: string }) => {
  const [showWarning, setShowWarning] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // 如果 AI 准备好了，或者报错了，都算“有了结果”，取消加载等待
    if (aiStatus.includes("READY") || aiStatus.includes("ERROR")) {
      setIsLoaded(true);
      setShowWarning(false);
      return;
    }

    // 如果 6 秒后还没有加载完，就显示 VPN 提示
    const timer = setTimeout(() => {
      if (!isLoaded) {
        setShowWarning(true);
      }
    }, 6000); // 6000ms = 6秒

    return () => clearTimeout(timer);
  }, [aiStatus, isLoaded]);

  // 如果已经加载成功，不显示任何东西
  if (isLoaded && !showWarning) return null;

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
      zIndex: 999,
      pointerEvents: 'none', // 让点击能穿透，不阻挡操作
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      transition: 'opacity 0.5s'
    }}>
      {/* 加载中的提示 */}
      {!showWarning && !isLoaded && (
        <div style={{ background: 'rgba(0,0,0,0.6)', padding: '10px 20px', borderRadius: '20px', backdropFilter: 'blur(4px)', color: '#FFD700', border: '1px solid #FFD700' }}>
          ✨ LOADING MAGIC...
        </div>
      )}

      {/* 超时警告提示 (带 VPN 建议) */}
      {showWarning && (
        <div style={{
          background: 'rgba(50, 0, 0, 0.85)',
          padding: '20px 30px',
          borderRadius: '12px',
          border: '1px solid #ff4444',
          textAlign: 'center',
          backdropFilter: 'blur(10px)',
          maxWidth: '80%',
          pointerEvents: 'auto' // 这个提示框允许点击（如果有按钮的话）
        }}>
          <h3 style={{ color: '#ff4444', margin: '0 0 10px 0', fontSize: '18px' }}>⚠️ Connection Slow</h3>
          <p style={{ color: '#fff', fontSize: '14px', lineHeight: '1.5', margin: 0 }}>
            AI 模型加载超时。如果您在中国大陆，<br/>
            <strong>请开启 VPN 或加速器</strong> 以体验手势交互。<br/>
            <span style={{ fontSize: '12px', color: '#888', display: 'block', marginTop: '8px' }}>(资源来自 Google 服务器)</span>
          </p>
        </div>
      )}
    </div>
  );
};
// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const toggleMusic = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (audioRef.current) {
      if (isPlaying) { audioRef.current.pause(); } else { audioRef.current.play().catch((e) => console.log('播放失败:', e)); }
      setIsPlaying(!isPlaying);
    }
  };

  useEffect(() => {
    const handleFirstInteraction = () => {
      if (audioRef.current && audioRef.current.paused) {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    };
    window.addEventListener('click', handleFirstInteraction, { once: true });
    window.addEventListener('touchstart', handleFirstInteraction, { once: true });
    return () => {
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      
      {/* --- 新增：在这里插入刚才写的网络检测组件 --- */}
      <NetworkWarning aiStatus={aiStatus} />

      <audio ref={audioRef} src="/bgm.mp3" loop />
      {/* 音乐按钮 (已在左上角) */}
      <button onClick={toggleMusic} style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 20, width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(4px)', fontSize: '20px', userSelect: 'none' }}>
        {isPlaying ? '♪' : '✕'}
      </button>

      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
            <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} />
        </Canvas>
      </div>
      <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} debugMode={debugMode} />

      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Memories</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.ornaments.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Foliage</p>
          <p style={{ fontSize: '24px', color: '#004225', fontWeight: 'bold', margin: 0 }}>
            {(CONFIG.counts.foliage * 3 / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>FOREST NEEDLES</span>
          </p>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}
        </button>
      </div>
      
      {/* 这里的旧状态提示可以保留，作为技术调试信息 */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>
    </div>
  );
}