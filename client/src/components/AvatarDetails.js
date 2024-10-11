import React, { Suspense, useRef, useEffect, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import PageHeader from './PageHeader';
import './AvatarDetails.css';

function Model({ url, animationName }) {
  const { scene, camera } = useThree();
  const modelRef = useRef();
  const mixerRef = useRef();
  const actionsRef = useRef({});

  useEffect(() => {
    const loader = new FBXLoader();
    loader.load(
      url,
      (fbx) => {
        // 기존 모델 제거
        if (modelRef.current) {
          scene.remove(modelRef.current);
        }

        fbx.scale.set(0.48, 0.48, 0.48); // 모델 크기를 약간 줄임
        fbx.position.set(0, -0.5, 0); // 모델을 약간 아래로 이동
        fbx.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
              child.material.shininess = 0;
            }
          }
        });
        
        const box = new THREE.Box3().setFromObject(fbx);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = 40; // FOV를 줄여 더 넓은 시야를 확보
        const cameraZ = Math.abs(maxDim / Math.sin((fov / 2) * Math.PI / 180));
        fbx.position.sub(center);

        scene.add(fbx);
        modelRef.current = fbx;

        if (camera) {
          camera.position.set(0, 0, cameraZ * 0.75); // 카메라를 더 가깝게 이동
          camera.fov = fov;
          camera.updateProjectionMatrix(); // 카메라 설정 변경 후 업데이트
          camera.lookAt(new THREE.Vector3(0, 0, 0));
        }

        const mixer = new THREE.AnimationMixer(fbx);
        mixerRef.current = mixer;

        console.log("Available animations:", fbx.animations.map(anim => anim.name));

        fbx.animations.forEach((clip) => {
          const action = mixer.clipAction(clip);
          actionsRef.current[clip.name] = action;
        });

        playAnimation(animationName);
      },
      (xhr) => {
        console.log((xhr.loaded / xhr.total) * 100 + '% loaded');
      },
      (error) => {
        console.error('모델 로드 중 오류 발생:', error);
      }
    );

    return () => {
      if (modelRef.current) {
        scene.remove(modelRef.current);
      }
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
      }
    };
  }, [scene, url, camera, animationName]);

  const playAnimation = (name) => {
    if (mixerRef.current && actionsRef.current[name]) {
      Object.values(actionsRef.current).forEach(action => action.stop());
      const action = actionsRef.current[name];
      action.setLoop(THREE.LoopRepeat);
      action.reset().play();
      console.log(`Playing animation: ${name}`);
    }
  };

  useFrame((state, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
  });

  return null;
}

function Lights() {
  return (
    <>
      <ambientLight intensity={1.0} />
      <directionalLight
        intensity={1.2}
        position={[10, 10, 5]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight intensity={3.2} position={[-10, -10, -5]} />
    </>
  );
}

function AvatarDetails() {
  const [animationName, setAnimationName] = useState("mixamo.com");

  const memoizedModel = useMemo(() => (
    <Model url={`${process.env.PUBLIC_URL}/models/greeting.fbx`} animationName={animationName} />
  ), [animationName]);

  return (
    <div className="avatar-details-page">
      <PageHeader 
        title="AI 및 3D 캐릭터" 
        backgroundImage={`${process.env.PUBLIC_URL}/images/intra-bg.jpg`}
      />
      <div className="avatar-details-content">
        <section className="avatar-section">
          <h2 className="section-title">눈으로 보이는 AI 에이전시로 활용</h2>
          <div className="section-content">
            <div className="text-box">
              <div className="text-content">
                <p>3D 캐릭터의 경험과 가능성을 지금 경험하세요.</p>
                <div className="animation-buttons">
                  <button onClick={() => setAnimationName("mixamo.com")}>[인사]</button>
                  <button onClick={() => setAnimationName("Take 001")}>[기본형]</button>
                </div>
              </div>
            </div>
            <div className="model-box">
              <Suspense fallback={<div>Loading...</div>}>
                <Canvas shadows>
                  <PerspectiveCamera makeDefault fov={50} position={[0, 0, 5]} />
                  <Lights />
                  {memoizedModel}
                  <OrbitControls enablePan={false} enableZoom={false} />
                </Canvas>
              </Suspense>
            </div>
          </div>
        </section>

        <section className="avatar-section">
          <h2 className="section-title">AI 영어(한국어) 학습과정</h2>
          <div className="section-content">
            <div className="image-box">
              <img src={process.env.PUBLIC_URL + "/images/gold.png"} alt="AI 설명" />
            </div>
            <div className="text-box">
              <div className="text-content">
                <p>AI 기술의 혁신과 활용에 대한 미래를 제공합니다.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="avatar-section">
          <h2 className="section-title">AI에 의한 실시간 음성 번역</h2>
          <div className="section-content">
            <div className="text-box">
              <div className="text-content">
                <p>AI비서, 이미 여러분의 곁에 있습니다.</p>
              </div>
            </div>
            <div className="image-box">
              <img src={process.env.PUBLIC_URL + "/images/gongong.png"} alt="AI 설명" />
            </div>
          </div>
        </section>
      </div> 
    </div>
  );
}

export default AvatarDetails;