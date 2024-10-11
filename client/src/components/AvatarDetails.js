import React, { Suspense, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import './AvatarDetails.css';

function Model({ url, animationIndex }) {
  const { scene, camera } = useThree();
  const modelRef = useRef();
  const mixerRef = useRef();
  const actionsRef = useRef([]);

  useEffect(() => {
    const loader = new FBXLoader();
    loader.load(
      url,
      (fbx) => {
        fbx.scale.set(0.04, 0.04, 0.04); // 모델 사이즈를 2배로 증가
        fbx.position.set(0, 0, 0);
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
        const fov = 50;
        const cameraZ = Math.abs(maxDim / Math.sin((fov / 2) * Math.PI / 180));
        fbx.position.sub(center);

        scene.add(fbx);
        modelRef.current = fbx;

        if (camera) {
          camera.position.set(0, 0, cameraZ * 1.5); // 카메라 위치 조정
          camera.lookAt(new THREE.Vector3(0, 0, 0));
        }

        const mixer = new THREE.AnimationMixer(fbx);
        mixerRef.current = mixer;

        console.log("Available animations:", fbx.animations.map(anim => anim.name));

        fbx.animations.forEach((clip) => {
          const action = mixer.clipAction(clip);
          actionsRef.current.push(action);
        });

        playAnimation(animationIndex);
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
  }, [scene, url, camera, animationIndex]);

  useEffect(() => {
    playAnimation(animationIndex);
  }, [animationIndex]);

  const playAnimation = (index) => {
    if (mixerRef.current && actionsRef.current.length > index) {
      mixerRef.current.stopAllAction();
      const action = actionsRef.current[index];
      action.setLoop(THREE.LoopRepeat);
      action.reset().play();
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
      <ambientLight intensity={0.5} />
      <directionalLight
        intensity={0.6}
        position={[10, 10, 5]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight intensity={1.6} position={[-10, -10, -5]} />
    </>
  );
}

function AvatarDetails() {
  const [animationIndex, setAnimationIndex] = useState(0);

  return (
    <div className="avatar-details-container">
      <div className="avatar-details-header" style={{ backgroundImage: `url(${process.env.PUBLIC_URL + '/images/intra-bg.jpg'})` }}>
        <h1>AI 및 3D 캐릭터 설명</h1>
      </div>
      <div className="avatar-details-content">
        <div className="avatar-section">
          <h2>눈으로 보이는 AI 에이전시로 활용</h2>
          <div className="image-text-container">
            <div className="text-box">
              <p>3D 캐릭터의 경험과 가능성을 지금 경험하세요.</p>
              <div className="animation-buttons">
                <button onClick={() => setAnimationIndex(0)}>[기본형]</button>
                <button onClick={() => setAnimationIndex(1)}>[인사]</button>
              </div>
            </div>
            <div className="threejs-container">
              <Suspense fallback={<div>Loading...</div>}>
                <Canvas shadows>
                  <PerspectiveCamera makeDefault fov={50} position={[0, 0, 5]} />
                  <Lights />
                  <Model url={process.env.PUBLIC_URL + '/models/greeting.fbx'} animationIndex={animationIndex} />
                  <OrbitControls enablePan={false} enableZoom={false} />
                </Canvas>
              </Suspense>
            </div>
          </div>
        </div>

        <div className="avatar-section">
          <h2>AI 영어(한국어) 학습과정</h2>
          <div className="image-text-container">
            <div className="inner-container">
              <img src={process.env.PUBLIC_URL + "/images/gold.png"} alt="AI 설명" className="image-box" />
              <div className="text-box">
                <p>AI 기술의 혁신과 활용에 대한 미래를 제공합니다.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="avatar-section">
          <h2>AI에 의한 실시간 음성 번역</h2>
          <div className="image-text-container">
            <div className="inner-container">
              <div className="text-box">
                <p>AI비서, 이미 여러분의 곁에 있습니다.</p>
              </div>
              <img src={process.env.PUBLIC_URL + "/images/gongong.png"} alt="AI 설명" className="image-box" />
            </div>
          </div>
        </div>     
      </div> 
    </div>
  );
}

export default AvatarDetails;