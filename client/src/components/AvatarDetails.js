import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import './AvatarDetails.css';

function Model({ url }) {
  const { scene } = useThree();
  const [model, setModel] = useState(null);
  const mixerRef = useRef();

  useEffect(() => {
    const loader = new FBXLoader();
    loader.load(
      url,
      (fbx) => {
        fbx.scale.set(0.01, 0.01, 0.01);
        fbx.position.set(0, 0, 0);
        fbx.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        scene.add(fbx);
        setModel(fbx);

        if (fbx.animations.length > 0) {
          mixerRef.current = new THREE.AnimationMixer(fbx);
          const action = mixerRef.current.clipAction(fbx.animations[0]);
          action.play();
        }
      },
      (xhr) => {
        console.log((xhr.loaded / xhr.total) * 100 + '% loaded');
      },
      (error) => {
        console.error('모델 로드 중 오류 발생:', error);
      }
    );

    return () => {
      if (model) {
        scene.remove(model);
      }
    };
  }, [scene, url]);

  useFrame((state, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
  });

  return null;
}

function Scene() {
  const { scene } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(0xa0a0a0);
    scene.fog = new THREE.Fog(0xa0a0a0, 200, 1000);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 5);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 5);
    dirLight.position.set(0, 200, 100);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 180;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -120;
    dirLight.shadow.camera.right = 120;
    scene.add(dirLight);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshPhongMaterial({ color: 0x999999, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const grid = new THREE.GridHelper(2000, 20, 0x000000, 0x000000);
    grid.material.opacity = 0.2;
    grid.material.transparent = true;
    scene.add(grid);
  }, [scene]);

  return null;
}

function AvatarDetails() {
  return (
    <div className="avatar-details-container">
    <div className="avatar-details-header" style={{ backgroundImage: `url(${process.env.PUBLIC_URL + '/images/intra-bg.jpg'})` }}>
      <h1>AI 및 3D 캐릭터 설명</h1>
    </div>
    <div className="avatar-details-content">
      <div className="avatar-section">
        <h2>이제는 눈으로 보이는 3D 캐릭터-AI 에이전시</h2>
        <div className="image-text-container">
          <div className="inner-container">
            <div className="text-box">
              <p>3D 캐릭터의 경험과 가능성을 지금 경험하세요.</p>                
            </div>
            <div className="threejs-container-wrapper">
              <div className="threejs-container">
                <Canvas
                  camera={{ position: [100, 200, 300], fov: 45 }}
                  shadows
                >
                  <Scene />
                  <Model url={process.env.PUBLIC_URL + '/models/standing.fbx'} />
                  <OrbitControls target={[0, 100, 0]} />
                </Canvas>
              </div>
            </div>
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