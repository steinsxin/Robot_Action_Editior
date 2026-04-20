import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import URDFLoader from 'urdf-loader';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="shell">
    <div class="workspace">
      <aside class="sidebar">
        <section class="card hero">
        <p class="eyebrow">Python URDF Viewer</p>
        <h1>机器人模型展示与关节控制</h1>
        <p>浏览器端负责 3D 渲染、拖拽和平移。</p>
        <p class="hint">左键旋转，滚轮缩放，右键平移。</p>
        </section>

        <section class="card section">
          <div class="section-header">
            <h2>模型选择</h2>
            <span class="section-title">切换型号</span>
          </div>
          <div class="control-grid compact-grid">
          <div class="field">
            <label for="robot-model">机器人型号</label>
            <select id="robot-model"></select>
          </div>
          <div class="field">
            <label for="robot-file">URDF 文件</label>
            <select id="robot-file"></select>
          </div>
          <div class="field">
            <button id="reload-button" type="button">重新加载模型</button>
          </div>
          <div class="field">
            <button id="drag-toggle" type="button">拖拽模型：关闭</button>
          </div>
          <div class="field">
            <button id="reset-camera" type="button">重置视角</button>
          </div>
          <div class="field">
            <button id="reset-pose" type="button">关节归零</button>
          </div>
          <div class="field field-span-2">
            <button id="save-pose" type="button">动作保存</button>
          </div>
          <div class="field field-span-2">
            <label for="saved-action">已保存动作</label>
            <select id="saved-action"></select>
          </div>
          <div class="field">
            <button id="load-action" type="button">加载动作</button>
          </div>
          <div class="field">
            <button id="refresh-actions" type="button">刷新动作列表</button>
          </div>
          </div>
          <div class="field path-field">
            <label for="urdf-path">当前 URDF</label>
            <div id="urdf-path" class="path-display"></div>
          </div>
          <p id="status" class="status">正在读取机器人配置…</p>
        </section>

        <section class="card section">
          <div class="section-header">
            <h2>基座控制</h2>
            <span class="section-title">拖拽 / 滑条</span>
          </div>
          <div id="base-controls" class="control-grid"></div>
        </section>

        <section class="card section section-grow">
          <div class="section-header">
            <h2>关节控制</h2>
            <span id="joint-count" class="hint">0 joints</span>
          </div>
          <div id="joint-list" class="joint-list">
            <div class="empty-state">模型加载后，这里会自动生成所有可控关节的滑条。</div>
          </div>
        </section>
      </aside>

      <section class="stage card">
        <div class="stage-header">
          <div>
            <p class="stage-label">3D Stage</p>
            <h2>机器人模型视图</h2>
          </div>
        </div>
        <div class="viewer">
          <div id="viewport"></div>
        </div>
      </section>
    </div>
  </main>
`;

const modelSelect = document.querySelector('#robot-model');
const fileSelect = document.querySelector('#robot-file');
const reloadButton = document.querySelector('#reload-button');
const dragToggleButton = document.querySelector('#drag-toggle');
const resetCameraButton = document.querySelector('#reset-camera');
const resetPoseButton = document.querySelector('#reset-pose');
const savePoseButton = document.querySelector('#save-pose');
const savedActionSelect = document.querySelector('#saved-action');
const loadActionButton = document.querySelector('#load-action');
const refreshActionsButton = document.querySelector('#refresh-actions');
const statusNode = document.querySelector('#status');
const urdfPathNode = document.querySelector('#urdf-path');
const jointCountNode = document.querySelector('#joint-count');
const jointListNode = document.querySelector('#joint-list');
const baseControlsNode = document.querySelector('#base-controls');
const viewport = document.querySelector('#viewport');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1020');
scene.fog = new THREE.Fog('#0b1020', 8, 32);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.07;
orbitControls.screenSpacePanning = true;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('translate');
transformControls.setSpace('world');
transformControls.visible = false;
scene.add(transformControls);
transformControls.addEventListener('dragging-changed', event => {
  transformDragging = event.value;
  syncInteractionState();
  if (!event.value) {
    syncBaseInputs();
  }
});

const hemiLight = new THREE.HemisphereLight('#8ea5ff', '#0b132f', 1.15);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight('#d8e5ff', 1.1);
dirLight.position.set(3, 4, 5);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight('#58b8ff', 0.55);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

const grid = new THREE.GridHelper(10, 20, '#6a7fff', '#2c4578');
grid.rotation.x = Math.PI / 2;
grid.material.opacity = 0.45;
grid.material.transparent = true;
scene.add(grid);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(4.8, 64),
  new THREE.MeshStandardMaterial({
    color: '#101833',
    transparent: true,
    opacity: 0.92,
    roughness: 0.96,
    metalness: 0.04
  })
);
ground.position.z = -0.002;
scene.add(ground);

const robotGroup = new THREE.Group();
scene.add(robotGroup);

const baseState = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0
};

const baseInputs = new Map();
let manifest = null;
let currentRobot = null;
let dragEnabled = false;
let jointControllers = [];
let jointOrderIndex = new Map();
let savedActions = [];
let sliderDragCount = 0;
let transformDragging = false;

const ACTION_GROUPS = {
  waist_leg: [
    'Joint_Ankle',
    'Joint_Knee',
    'Joint_Waist_Pitch',
    'Joint_Waist_Yaw',
  ],
  left_arm: [
    'Joint_Left_Shoulder_Inner',
    'Joint_Left_Shoulder_Outer',
    'Joint_Left_UpperArm',
    'Joint_Left_Elbow',
    'Joint_Left_Forearm',
    'Joint_Left_Wrist_Upper',
    'Joint_Left_Wrist_Lower',
  ],
  right_arm: [
    'Joint_Right_Shoulder_Inner',
    'Joint_Right_Shoulder_Outer',
    'Joint_Right_UpperArm',
    'Joint_Right_Elbow',
    'Joint_Right_Forearm',
    'Joint_Right_Wrist_Upper',
    'Joint_Right_Wrist_Lower',
  ],
};

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle('error', isError);
}

function setSavedActionPlaceholder(message) {
  savedActionSelect.innerHTML = '';

  const option = document.createElement('option');
  option.value = '';
  option.textContent = message;
  savedActionSelect.appendChild(option);
  savedActionSelect.value = '';
  savedActionSelect.disabled = true;
  loadActionButton.disabled = true;
}

function formatAngle(value) {
  const degrees = THREE.MathUtils.radToDeg(value);
  return `${value.toFixed(3)} rad / ${degrees.toFixed(1)}°`;
}

function roundDegrees(valueInRadians) {
  return Math.round(THREE.MathUtils.radToDeg(valueInRadians));
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = viewport;
  if (!clientWidth || !clientHeight) {
    return;
  }

  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
}

function resetCamera() {
  camera.position.set(2.8, -3.2, 1.9);
  orbitControls.target.set(0, 0, 0.9);
  orbitControls.update();
}

function applyRobotMaterials(robot) {
  robot.traverse(object => {
    if (!object.isMesh) {
      return;
    }

    const originalScale = object.scale.clone();
    object.material = new THREE.MeshStandardMaterial({
      color: '#c8d6ff',
      emissive: '#171d39',
      emissiveIntensity: 0.22,
      roughness: 0.58,
      metalness: 0.22,
      side: THREE.DoubleSide
    });
    object.castShadow = true;
    object.receiveShadow = true;
    object.scale.copy(originalScale);
  });
}

function clearRobot() {
  if (currentRobot) {
    transformControls.detach();
    robotGroup.remove(currentRobot);
  }

  currentRobot = null;
  jointControllers = [];
  jointListNode.innerHTML = '<div class="empty-state">模型加载后，这里会自动生成所有可控关节的滑条。</div>';
  jointCountNode.textContent = '0 joints';
}

function syncInteractionState() {
  const sliderDragging = sliderDragCount > 0;
  orbitControls.enabled = !transformDragging && !sliderDragging;
  document.body.classList.toggle('slider-dragging', sliderDragging);
}

function attachSliderInteractionGuards(slider) {
  const beginDrag = event => {
    event.stopPropagation();

    if (slider.dataset.dragging === 'true') {
      return;
    }

    slider.dataset.dragging = 'true';
    sliderDragCount += 1;

    if (typeof event.pointerId === 'number' && slider.setPointerCapture) {
      slider.setPointerCapture(event.pointerId);
    }

    syncInteractionState();
  };

  const endDrag = event => {
    if (slider.dataset.dragging !== 'true') {
      return;
    }

    delete slider.dataset.dragging;
    sliderDragCount = Math.max(0, sliderDragCount - 1);

    if (typeof event?.pointerId === 'number' && slider.releasePointerCapture?.(event.pointerId)) {
      slider.releasePointerCapture(event.pointerId);
    }

    syncInteractionState();
  };

  slider.addEventListener('pointerdown', beginDrag);
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);
  slider.addEventListener('lostpointercapture', endDrag);
  slider.addEventListener('blur', endDrag);
  slider.addEventListener('click', event => event.stopPropagation());
}

function countMeshes(root) {
  let count = 0;
  root.traverse(object => {
    if (object.isMesh) {
      count += 1;
    }
  });
  return count;
}

function collectJoints(robot) {
  return Object.values(robot.joints)
    .filter(joint => ['revolute', 'continuous', 'prismatic'].includes(joint.jointType))
    .filter(joint => !isHiddenJoint(joint.name))
    .sort(compareJointsByUrdfOrder);
}

function compareJointsByUrdfOrder(left, right) {
  const leftIndex = jointOrderIndex.get(left.name) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = jointOrderIndex.get(right.name) ?? Number.MAX_SAFE_INTEGER;

  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return left.name.localeCompare(right.name, undefined, { numeric: true });
}

function isHiddenJoint(jointName) {
  const normalized = jointName.toLowerCase();
  return ['gripper', 'finger', 'knuckle', 'mimic'].some(token => normalized.includes(token));
}

function getJointGroup(jointName) {
  const normalized = jointName.toLowerCase();

  if (normalized.includes('ankle') || normalized.includes('knee')) {
    return { key: 'lower-body', label: 'Lower Body', order: 1 };
  }
  if (normalized.includes('waist')) {
    return { key: 'waist', label: 'Waist', order: 2 };
  }
  if (normalized.includes('left_')) {
    return { key: 'left-arm', label: 'Left Arm', order: 3 };
  }
  if (normalized.includes('right_')) {
    return { key: 'right-arm', label: 'Right Arm', order: 4 };
  }
  if (normalized.includes('neck') || normalized.includes('head')) {
    return { key: 'neck', label: 'Neck', order: 5 };
  }

  return { key: 'other', label: 'Other', order: 6 };
}

function groupJoints(joints) {
  const groups = new Map();

  for (const joint of joints) {
    const group = getJointGroup(joint.name);
    if (!groups.has(group.key)) {
      groups.set(group.key, {
        ...group,
        joints: []
      });
    }
    groups.get(group.key).joints.push(joint);
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      joints: group.joints.sort(compareJointsByUrdfOrder),
      firstIndex: Math.min(...group.joints.map(joint => jointOrderIndex.get(joint.name) ?? Number.MAX_SAFE_INTEGER))
    }))
    .sort((left, right) => {
      if (left.firstIndex !== right.firstIndex) {
        return left.firstIndex - right.firstIndex;
      }
      return left.order - right.order;
    });
}

function createJointCard(joint) {
  const lower = Number.isFinite(joint.limit?.lower) ? joint.limit.lower : -Math.PI;
  const upper = Number.isFinite(joint.limit?.upper) ? joint.limit.upper : Math.PI;
  const initial = Number.isFinite(joint.angle) ? joint.angle : 0;

  const card = document.createElement('article');
  card.className = 'joint-card';
  card.innerHTML = `
    <header>
      <h3>${joint.name}</h3>
      <span class="joint-value">${formatAngle(initial)}</span>
    </header>
    <input type="range" min="${lower}" max="${upper}" step="0.001" value="${initial}" />
    <p class="joint-meta">范围: ${formatAngle(lower)} ~ ${formatAngle(upper)}</p>
  `;

  const valueNode = card.querySelector('.joint-value');
  const slider = card.querySelector('input');

  attachSliderInteractionGuards(slider);

  slider.addEventListener('input', event => {
    const nextValue = Number(event.currentTarget.value);
    joint.setJointValue(nextValue);
    valueNode.textContent = formatAngle(nextValue);
  });

  return card;
}

function updateRobotTransform() {
  robotGroup.position.set(baseState.x, baseState.y, baseState.z);
  robotGroup.rotation.set(0, 0, baseState.yaw);
}

function syncBaseInputs() {
  baseState.x = robotGroup.position.x;
  baseState.y = robotGroup.position.y;
  baseState.z = robotGroup.position.z;
  baseState.yaw = robotGroup.rotation.z;

  for (const [key, input] of baseInputs.entries()) {
    input.value = String(baseState[key]);
    const valueNode = input.parentElement.querySelector('.joint-value');
    valueNode.textContent = key === 'yaw' ? formatAngle(baseState[key]) : `${baseState[key].toFixed(3)} m`;
  }
}

function createBaseControl(key, label, min, max, step) {
  const card = document.createElement('article');
  card.className = 'joint-card';
  card.innerHTML = `
    <header>
      <h3>${label}</h3>
      <span class="joint-value">0</span>
    </header>
    <input type="range" min="${min}" max="${max}" step="${step}" value="0" />
    <p class="joint-meta">${key === 'yaw' ? '基座朝向' : '基座平移'}</p>
  `;

  const input = card.querySelector('input');
  const valueNode = card.querySelector('.joint-value');
  baseInputs.set(key, input);

  attachSliderInteractionGuards(input);

  input.addEventListener('input', event => {
    baseState[key] = Number(event.currentTarget.value);
    updateRobotTransform();
    valueNode.textContent = key === 'yaw' ? formatAngle(baseState[key]) : `${baseState[key].toFixed(3)} m`;
  });

  baseControlsNode.appendChild(card);
  valueNode.textContent = key === 'yaw' ? formatAngle(0) : '0.000 m';
}

function buildBaseControls() {
  if (baseControlsNode.children.length > 0) {
    return;
  }

  createBaseControl('x', 'Base X', -2, 2, 0.01);
  createBaseControl('y', 'Base Y', -2, 2, 0.01);
  createBaseControl('z', 'Base Z', -0.5, 2, 0.01);
  createBaseControl('yaw', 'Base Yaw', -Math.PI, Math.PI, 0.01);
}

function renderJointControls(robot) {
  const joints = collectJoints(robot);
  jointControllers = joints;
  jointCountNode.textContent = `${joints.length} joints`;

  if (joints.length === 0) {
    jointListNode.innerHTML = '<div class="empty-state">当前模型没有可直接控制的关节。</div>';
    return;
  }

  jointListNode.innerHTML = '';

  for (const group of groupJoints(joints)) {
    const details = document.createElement('details');
    details.className = 'joint-group';
    details.open = true;
    details.innerHTML = `
      <summary>
        <span>${group.label}</span>
        <span class="joint-group-count">${group.joints.length}</span>
      </summary>
      <div class="joint-group-list"></div>
    `;

    const listNode = details.querySelector('.joint-group-list');
    for (const joint of group.joints) {
      listNode.appendChild(createJointCard(joint));
    }

    jointListNode.appendChild(details);
  }
}

function frameRobot(root) {
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.8);

  robotGroup.position.sub(center);
  robotGroup.position.z -= bounds.min.z;
  syncBaseInputs();

  camera.position.set(radius * 1.8, -radius * 2.3, radius * 1.35);
  orbitControls.target.set(0, 0, size.z * 0.4);
  orbitControls.maxDistance = radius * 8;
  camera.near = Math.max(radius / 500, 0.01);
  camera.far = radius * 40;
  camera.updateProjectionMatrix();
  orbitControls.update();

  return { size, radius };
}

async function fetchManifest() {
  const response = await fetch('/api/manifest');
  if (!response.ok) {
    throw new Error(`Manifest request failed: ${response.status}`);
  }
  manifest = await response.json();
  jointOrderIndex = new Map((manifest.jointOrder || []).map((jointName, index) => [jointName, index]));
}

async function fetchSavedActions(preferredFileName = '') {
  const response = await fetch('/api/saved-actions');
  if (!response.ok) {
    throw new Error(`Saved actions request failed: ${response.status}`);
  }

  const result = await response.json();
  savedActions = Array.isArray(result.actions) ? result.actions : [];
  populateSavedActionOptions(preferredFileName);
}

function populateSavedActionOptions(preferredFileName = '') {
  if (savedActions.length === 0) {
    setSavedActionPlaceholder('暂无已保存动作');
    return;
  }

  savedActionSelect.innerHTML = '';
  savedActionSelect.disabled = false;
  loadActionButton.disabled = false;

  for (const action of savedActions) {
    const option = document.createElement('option');
    option.value = action.fileName;
    option.textContent = action.title || action.fileName;
    savedActionSelect.appendChild(option);
  }

  const selectedFileName = preferredFileName && savedActions.some(action => action.fileName === preferredFileName)
    ? preferredFileName
    : savedActions[0].fileName;

  savedActionSelect.value = selectedFileName;
}

function populateModelOptions() {
  modelSelect.innerHTML = '';
  for (const robot of manifest.robots) {
    const option = document.createElement('option');
    option.value = robot.model;
    option.textContent = robot.model;
    modelSelect.appendChild(option);
  }

  modelSelect.value = manifest.defaultSelection.model;
  populateFileOptions();

  const hasDefaultFile = Array.from(fileSelect.options).some(option => option.value === manifest.defaultSelection.file);
  if (hasDefaultFile) {
    fileSelect.value = manifest.defaultSelection.file;
  }

  if (manifest.robots.length === 1 && manifest.robots[0].files.length === 1) {
    modelSelect.disabled = true;
    fileSelect.disabled = true;
  }
}

function getSelectedEntry() {
  return manifest.robots.find(robot => robot.model === modelSelect.value) ?? null;
}

function populateFileOptions() {
  const selected = getSelectedEntry();
  fileSelect.innerHTML = '';
  if (!selected) {
    return;
  }

  for (const file of selected.files) {
    const option = document.createElement('option');
    option.value = file.file;
    option.textContent = file.label;
    fileSelect.appendChild(option);
  }
}

function selectedUrdfUrl() {
  const selected = getSelectedEntry();
  if (!selected) {
    return null;
  }
  return selected.files.find(file => file.file === fileSelect.value)?.url ?? null;
}

async function loadRobot() {
  const urdfUrl = selectedUrdfUrl();
  if (!urdfUrl) {
    setStatus('没有找到可加载的 URDF 文件。', true);
    return;
  }

  clearRobot();
  robotGroup.position.set(0, 0, 0);
  robotGroup.rotation.set(0, 0, 0);
  Object.assign(baseState, { x: 0, y: 0, z: 0, yaw: 0 });
  syncBaseInputs();
  urdfPathNode.textContent = manifest.urdfPath || selectedUrdfUrl();
  setStatus(`正在加载 ${fileSelect.value} ...`);

  try {
    const manager = new THREE.LoadingManager();
    const assetsReady = new Promise(resolve => {
      manager.onLoad = () => resolve();
    });
    const loader = new URDFLoader(manager);

    const robot = await new Promise((resolve, reject) => {
      loader.load(urdfUrl, loadedRobot => resolve(loadedRobot), undefined, error => reject(error));
    });

    currentRobot = robot;
    robotGroup.add(robot);

    await assetsReady;

    applyRobotMaterials(robot);
    robot.updateMatrixWorld(true);
    robotGroup.updateMatrixWorld(true);
    renderJointControls(robot);
    const meshCount = countMeshes(robot);
    const { size, radius } = frameRobot(robot);

    if (dragEnabled) {
      transformControls.attach(robotGroup);
      transformControls.visible = true;
    }

    setStatus(`已加载 ${modelSelect.value} / ${fileSelect.value}，meshes: ${meshCount}，size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}，radius: ${radius.toFixed(2)}`);
  } catch (error) {
    console.error(error);
    setStatus(`模型加载失败: ${error.message}`, true);
  }
}

function buildPosePayload() {
  const jointMap = new Map(
    jointControllers.map(joint => [joint.name, Number.isFinite(joint.angle) ? joint.angle : 0])
  );

  return {
    left_arm: ACTION_GROUPS.left_arm.map(jointName => roundDegrees(jointMap.get(jointName) ?? 0)),
    right_arm: ACTION_GROUPS.right_arm.map(jointName => roundDegrees(jointMap.get(jointName) ?? 0)),
    waist_leg: ACTION_GROUPS.waist_leg.map(jointName => roundDegrees(jointMap.get(jointName) ?? 0)),
    duration: 2.0,
  };
}

function applySavedPose(payload) {
  if (!currentRobot) {
    setStatus('当前没有已加载的机器人模型，无法加载动作。', true);
    return;
  }

  const jointMap = new Map(jointControllers.map(joint => [joint.name, joint]));
  let appliedCount = 0;

  for (const [groupName, jointNames] of Object.entries(ACTION_GROUPS)) {
    const values = Array.isArray(payload?.[groupName]) ? payload[groupName] : [];

    jointNames.forEach((jointName, index) => {
      const joint = jointMap.get(jointName);
      const degrees = Number(values[index]);

      if (!joint || !Number.isFinite(degrees)) {
        return;
      }

      joint.setJointValue(THREE.MathUtils.degToRad(degrees));
      appliedCount += 1;
    });
  }

  renderJointControls(currentRobot);

  if (appliedCount === 0) {
    setStatus('动作加载失败: 当前文件中没有可应用的关节数据。', true);
    return;
  }

  const selectedAction = savedActions.find(action => action.fileName === savedActionSelect.value);
  setStatus(`已加载动作: ${selectedAction?.title || savedActionSelect.value}，已应用 ${appliedCount} 个关节。`);
}

function loadSelectedAction() {
  const selectedAction = savedActions.find(action => action.fileName === savedActionSelect.value);
  if (!selectedAction) {
    setStatus('请先选择一个已保存动作。', true);
    return;
  }

  applySavedPose(selectedAction.payload || {});
}

async function refreshSavedActions(options = {}) {
  const { silent = false, preferredFileName = '' } = options;

  try {
    await fetchSavedActions(preferredFileName);
    if (!silent) {
      setStatus(`已刷新动作列表，共 ${savedActions.length} 个动作。`);
    }
  } catch (error) {
    console.error(error);
    setSavedActionPlaceholder('动作列表读取失败');
    setStatus(`动作列表读取失败: ${error.message}`, true);
  }
}

async function saveCurrentPose() {
  if (!currentRobot) {
    setStatus('当前没有已加载的机器人模型，无法保存动作。', true);
    return;
  }

  const title = window.prompt('请输入动作标题名', 'new_action');
  if (title === null) {
    return;
  }

  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    setStatus('动作保存失败: 标题不能为空。', true);
    return;
  }

  try {
    const response = await fetch('/api/save-pose', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: trimmedTitle,
        ...buildPosePayload(),
      })
    });

    if (!response.ok) {
      throw new Error(`Save request failed: ${response.status}`);
    }

    const result = await response.json();
    await refreshSavedActions({ silent: true, preferredFileName: result.fileName });
    setStatus(`动作已保存: ${result.path}`);
  } catch (error) {
    console.error(error);
    setStatus(`动作保存失败: ${error.message}`, true);
  }
}

function resetPose() {
  if (!currentRobot) {
    return;
  }
  for (const joint of jointControllers) {
    joint.setJointValue(0);
  }
  renderJointControls(currentRobot);
}

function toggleDragMode() {
  dragEnabled = !dragEnabled;
  dragToggleButton.classList.toggle('active', dragEnabled);
  dragToggleButton.textContent = `拖拽模型：${dragEnabled ? '开启' : '关闭'}`;

  if (dragEnabled && currentRobot) {
    transformControls.attach(robotGroup);
    transformControls.visible = true;
  } else {
    transformControls.detach();
    transformControls.visible = false;
  }
}

modelSelect.addEventListener('change', () => {
  populateFileOptions();
  loadRobot();
});

fileSelect.addEventListener('change', () => {
  loadRobot();
});

reloadButton.addEventListener('click', () => {
  loadRobot();
});

dragToggleButton.addEventListener('click', () => {
  toggleDragMode();
});

resetCameraButton.addEventListener('click', () => {
  resetCamera();
});

resetPoseButton.addEventListener('click', () => {
  resetPose();
});

savePoseButton.addEventListener('click', () => {
  saveCurrentPose();
});

loadActionButton.addEventListener('click', () => {
  loadSelectedAction();
});

refreshActionsButton.addEventListener('click', () => {
  refreshSavedActions();
});

window.addEventListener('resize', () => {
  resizeRenderer();
});

function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  renderer.render(scene, camera);
}

async function init() {
  buildBaseControls();
  resetCamera();
  resizeRenderer();
  animate();

  try {
    await fetchManifest();
    await refreshSavedActions({ silent: true });
    populateModelOptions();
    await loadRobot();
  } catch (error) {
    console.error(error);
    setStatus(`初始化失败: ${error.message}`, true);
  }
}

init();