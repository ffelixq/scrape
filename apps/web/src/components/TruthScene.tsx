import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Line, OrbitControls, Sphere } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';

function EvidenceConstellation() {
  const group = useRef<Group>(null);
  const points = useMemo<[number, number, number][]>(
    () => [
      [-2.2, 0.9, 0.2],
      [-1.5, -1.1, 0.5],
      [0, 0, 0],
      [1.75, 1.2, -0.1],
      [2.1, -0.8, 0.3],
      [0.65, 2, -0.4],
      [-0.2, -2, -0.2],
    ],
    [],
  );

  useFrame((state) => {
    if (group.current) {
      group.current.rotation.y = state.clock.elapsedTime * 0.08;
      group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.12) * 0.08;
    }
  });

  return (
    <group ref={group}>
      {points.slice(1).map((point, index) => (
        <Line
          key={`line-${index}`}
          points={[points[0]!, point]}
          color={index === 3 ? '#e26642' : '#4f8f72'}
          transparent
          opacity={0.38}
          lineWidth={0.7}
        />
      ))}
      {points.map((position, index) => (
        <Float key={index} speed={1 + index * 0.08} floatIntensity={0.22}>
          <Sphere args={[index === 0 ? 0.34 : 0.13, 24, 24]} position={position}>
            <meshStandardMaterial
              color={index === 3 ? '#e26642' : index === 0 ? '#11231b' : '#62b78f'}
              roughness={0.28}
              metalness={0.08}
            />
          </Sphere>
        </Float>
      ))}
    </group>
  );
}

export function TruthScene() {
  const splineScene = import.meta.env.VITE_SPLINE_SCENE_URL;

  if (splineScene) {
    return (
      <div className="truth-scene" aria-hidden="true">
        <iframe
          src={splineScene}
          title="Proofline evidence constellation"
          tabIndex={-1}
          loading="eager"
        />
      </div>
    );
  }

  return (
    <div className="truth-scene" aria-hidden="true">
      <Canvas camera={{ position: [0, 0, 7], fov: 42 }} dpr={[1, 1.5]}>
        <ambientLight intensity={1.8} />
        <directionalLight position={[4, 5, 4]} intensity={2.6} />
        <EvidenceConstellation />
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.22} />
      </Canvas>
    </div>
  );
}
