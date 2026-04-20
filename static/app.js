import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import URDFLoader from 'urdf-loader';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="shell">
    <section class="masthead card">
      <div>
        <p class="eyebrow">Robot Composer</p>
      </div>
      <div class="masthead-badges">
        <span class="badge">Motion + Voice</span>
        <span class="badge">100Hz</span>
      </div>
    </section>

    <div class="workspace">
      <section class="studio">
        <section class="card stage-card">
          <div class="stage-topbar">
            <div class="toolbar-grid compact-toolbar-grid">
              <div class="field">
                <label for="robot-model">机器人型号</label>
                <select id="robot-model"></select>
              </div>
              <div class="field">
                <label for="robot-file">URDF 文件</label>
                <select id="robot-file"></select>
              </div>
              <div class="field">
                <label for="project-picker">项目</label>
                <select id="project-picker"></select>
              </div>
            </div>
            <div class="transport-buttons compact-transport">
              <button id="reload-button" type="button">重载模型</button>
              <button id="drag-toggle" type="button">拖拽模型：关闭</button>
              <button id="reset-camera" type="button">重置视角</button>
              <button id="reset-pose" type="button">关节归零</button>
              <button id="play-toggle" type="button" class="accent">播放</button>
              <button id="stop-playback" type="button">停止</button>
            </div>
          </div>

          <div class="project-state-fields" hidden>
            <input id="project-title" type="hidden" value="untitled_project" />
            <input id="project-duration" type="hidden" value="12" />
            <input id="control-hz" type="hidden" value="100" />
            <input id="motion-topic" type="hidden" value="/robot/motion_plan" />
            <input id="voice-topic" type="hidden" value="/robot/tts_plan" />
            <input id="browser-voice-toggle" type="checkbox" checked hidden />
            <p id="status">正在读取机器人配置…</p>
            <strong id="urdf-path"></strong>
            <strong id="keyframe-count">0</strong>
            <strong id="voice-count">0</strong>
            <strong id="joint-count">0 joints</strong>
          </div>

          <div class="transport-row">
            <div class="transport-meta">
              <div class="time-readout">
                <span id="playhead-label">00:00.000</span>
                <span>/</span>
                <span id="duration-label">00:12.000</span>
              </div>
              <p class="stage-label">播放头可点击标尺或轨道快速跳转</p>
            </div>
            <div class="duration-tools">
              <label for="duration-quick-input">总时长</label>
              <input id="duration-quick-input" type="number" min="1" max="600" step="1" value="12" />
              <button id="extend-duration" type="button">+5s</button>
            </div>
          </div>

          <div class="viewer-shell">
            <div id="viewport"></div>
          </div>
        </section>

        <section class="card timeline-card">
          <div class="section-header">
            <div>
              <p class="eyebrow">Sequencer</p>
              <h2>动作与语音时间轴</h2>
              <p class="track-subtitle">动作轨插关键帧并自动插值，语音轨编排文本与时长。</p>
            </div>
            <div class="action-row timeline-actions">
              <button id="insert-keyframe" type="button" class="accent">插帧</button>
              <button id="update-keyframe" type="button">保存姿态</button>
              <button id="delete-keyframe" type="button">删帧</button>
              <button id="add-voice-clip" type="button">插语音</button>
              <button id="delete-voice-clip" type="button">删语音</button>
              <button id="save-project" type="button">保存</button>
              <button id="export-plan" type="button">导出100Hz</button>
            </div>
          </div>

          <div class="timeline-summary">
            <div class="summary-chip"><span>当前播放头</span><strong id="current-time-chip">0.000s</strong></div>
            <div class="summary-chip"><span>插值模式</span><strong>关键帧段级 easing</strong></div>
            <div class="summary-chip"><span>导出采样</span><strong id="sample-count-chip">1201 samples</strong></div>
          </div>

          <div class="timeline-board" id="timeline-board">
            <div class="timeline-ruler" id="timeline-ruler"></div>

            <div class="track-row">
              <div class="track-meta">
                <span class="track-title">动作轨</span>
                <span class="track-subtitle">关节关键帧 + 基座位姿</span>
              </div>
              <div class="track-lane" id="action-track"></div>
            </div>

            <div class="track-row">
              <div class="track-meta">
                <span class="track-title">语音轨</span>
                <span class="track-subtitle">文本 / 时长</span>
              </div>
              <div class="track-lane" id="voice-track"></div>
            </div>
          </div>
        </section>
      </section>

      <aside class="sidebar">
        <section class="card section">
          <div class="section-header">
            <h2>轨道检视器</h2>
            <span class="section-title">关键帧 / 语音</span>
          </div>
          <div class="inspector-split">
            <div>
              <p class="section-title">动作关键帧</p>
              <div id="keyframe-inspector" class="inspector-body empty-state">选中一个关键帧后，可修改时间、标签和 easing，也可以在当前姿态上覆盖它。</div>
            </div>
            <div>
              <p class="section-title">语音片段</p>
              <div id="voice-inspector" class="inspector-body empty-state">插入语音片段后，可修改开始时间、文本和持续时长。</div>
            </div>
          </div>
        </section>

        <section class="card section">
          <div class="section-header">
            <h2>快速语音输入</h2>
            <span class="section-title">用于新增片段</span>
          </div>
          <div class="field">
            <label for="voice-text">文本</label>
            <textarea id="voice-text" rows="3">你好，欢迎来到机器人动作创作平台。</textarea>
          </div>
          <div class="control-grid">
            <div class="field">
              <label for="voice-duration">时长 (s)</label>
              <input id="voice-duration" type="number" min="0.1" step="0.1" value="2.5" />
            </div>
            <div class="field">
              <label for="voice-name">语音名</label>
              <input id="voice-name" type="text" value="narration" />
            </div>
          </div>
        </section>

        <details class="card section collapsible-section">
          <summary class="section-header collapsible-summary">
            <h2>动作素材库</h2>
            <span class="section-title">单帧动作复用</span>
          </summary>
          <div class="control-grid compact-grid">
            <div class="field field-span-2">
              <button id="save-pose" type="button">保存当前姿态到素材库</button>
            </div>
            <div class="field field-span-2">
              <label for="saved-action">已保存动作</label>
              <select id="saved-action"></select>
            </div>
            <div class="field">
              <button id="load-action" type="button">加载姿态</button>
            </div>
            <div class="field">
              <button id="refresh-actions" type="button">刷新列表</button>
            </div>
          </div>
        </details>

        <details class="card section collapsible-section">
          <summary class="section-header collapsible-summary">
            <h2>基座控制</h2>
            <span class="section-title">平移 / 偏航</span>
          </summary>
          <div id="base-controls" class="control-grid"></div>
        </details>

        <details class="card section section-grow collapsible-section" open>
          <summary class="section-header collapsible-summary">
            <h2>关节控制</h2>
            <span class="section-title">手动摆姿</span>
          </summary>
          <div id="joint-list" class="joint-list">
            <div class="empty-state">模型加载后，这里会生成身体模块按钮。点击一个模块后，会从右侧展开对应的关节控制抽屉。</div>
          </div>
        </details>
      </aside>
    </div>

    <div id="joint-drawer-backdrop" class="joint-drawer-backdrop"></div>
    <aside id="joint-drawer" class="joint-drawer" aria-hidden="true">
      <div class="joint-drawer-header">
        <div>
          <p class="eyebrow">Joint Drawer</p>
          <h2 id="joint-drawer-title">关节模块</h2>
          <p id="joint-drawer-meta" class="joint-filter-meta">点击右侧模块按钮后，在这里调节对应关节。</p>
        </div>
        <button id="joint-drawer-close" type="button" class="joint-drawer-close">关闭</button>
      </div>
      <div id="joint-drawer-body" class="joint-drawer-body"></div>
    </aside>
  </main>
`;

const modelSelect = document.querySelector('#robot-model');
const fileSelect = document.querySelector('#robot-file');
const projectPicker = document.querySelector('#project-picker');
const projectTitleInput = document.querySelector('#project-title');
const projectDurationInput = document.querySelector('#project-duration');
const controlHzInput = document.querySelector('#control-hz');
const motionTopicInput = document.querySelector('#motion-topic');
const voiceTopicInput = document.querySelector('#voice-topic');
const reloadButton = document.querySelector('#reload-button');
const dragToggleButton = document.querySelector('#drag-toggle');
const resetCameraButton = document.querySelector('#reset-camera');
const resetPoseButton = document.querySelector('#reset-pose');
const playToggleButton = document.querySelector('#play-toggle');
const stopPlaybackButton = document.querySelector('#stop-playback');
const savePoseButton = document.querySelector('#save-pose');
const savedActionSelect = document.querySelector('#saved-action');
const loadActionButton = document.querySelector('#load-action');
const refreshActionsButton = document.querySelector('#refresh-actions');
const statusNode = document.querySelector('#status');
const urdfPathNode = document.querySelector('#urdf-path');
const keyframeCountNode = document.querySelector('#keyframe-count');
const voiceCountNode = document.querySelector('#voice-count');
const jointCountNode = document.querySelector('#joint-count');
const jointListNode = document.querySelector('#joint-list');
const jointDrawer = document.querySelector('#joint-drawer');
const jointDrawerBackdrop = document.querySelector('#joint-drawer-backdrop');
const jointDrawerTitle = document.querySelector('#joint-drawer-title');
const jointDrawerMeta = document.querySelector('#joint-drawer-meta');
const jointDrawerBody = document.querySelector('#joint-drawer-body');
const jointDrawerCloseButton = document.querySelector('#joint-drawer-close');
const baseControlsNode = document.querySelector('#base-controls');
const viewport = document.querySelector('#viewport');
const timelineBoard = document.querySelector('#timeline-board');
const timelineRuler = document.querySelector('#timeline-ruler');
const actionTrack = document.querySelector('#action-track');
const voiceTrack = document.querySelector('#voice-track');
const playheadLabel = document.querySelector('#playhead-label');
const durationLabel = document.querySelector('#duration-label');
const durationQuickInput = document.querySelector('#duration-quick-input');
const extendDurationButton = document.querySelector('#extend-duration');
const currentTimeChip = document.querySelector('#current-time-chip');
const sampleCountChip = document.querySelector('#sample-count-chip');
const keyframeInspector = document.querySelector('#keyframe-inspector');
const voiceInspector = document.querySelector('#voice-inspector');
const insertKeyframeButton = document.querySelector('#insert-keyframe');
const updateKeyframeButton = document.querySelector('#update-keyframe');
const deleteKeyframeButton = document.querySelector('#delete-keyframe');
const addVoiceClipButton = document.querySelector('#add-voice-clip');
const deleteVoiceClipButton = document.querySelector('#delete-voice-clip');
const saveProjectButton = document.querySelector('#save-project');
const exportPlanButton = document.querySelector('#export-plan');
const voiceTextInput = document.querySelector('#voice-text');
const voiceDurationInput = document.querySelector('#voice-duration');
const voiceNameInput = document.querySelector('#voice-name');
const browserVoiceToggle = document.querySelector('#browser-voice-toggle');

const TIMELINE_PIXELS_PER_SECOND = 96;
const PROJECT_MIN_DURATION = 1;
const DEFAULT_PROJECT_DURATION = 12;
const DEFAULT_CONTROL_HZ = 100;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#09111d');
scene.fog = new THREE.Fog('#09111d', 8, 36);

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

const hemiLight = new THREE.HemisphereLight('#b4d8ff', '#10243d', 1.18);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight('#f6fbff', 1.18);
dirLight.position.set(3, 4, 5);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight('#2ec4b6', 0.55);
fillLight.position.set(-4, 2, -2);
scene.add(fillLight);

const grid = new THREE.GridHelper(14, 28, '#56cfe1', '#1c4b60');
grid.rotation.x = Math.PI / 2;
grid.material.opacity = 0.42;
grid.material.transparent = true;
scene.add(grid);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6.2, 80),
  new THREE.MeshStandardMaterial({
    color: '#091722',
    transparent: true,
    opacity: 0.95,
    roughness: 0.92,
    metalness: 0.06,
  })
);
ground.position.z = -0.002;
scene.add(ground);

const robotGroup = new THREE.Group();
scene.add(robotGroup);

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

const EASING_MAP = {
  linear: value => value,
  easeInOut: value => (value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2),
  easeOut: value => 1 - Math.pow(1 - value, 3),
  easeIn: value => value * value * value,
};

const baseState = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
};

const baseInputs = new Map();
const jointWidgets = new Map();

let manifest = null;
let currentRobot = null;
let dragEnabled = false;
let jointControllers = [];
let jointOrderIndex = new Map();
let savedActions = [];
let savedProjects = [];
let sliderDragCount = 0;
let transformDragging = false;
let isPlaying = false;
let playbackStartedAt = 0;
let playbackFromTime = 0;
let lastPlaybackTime = 0;
let playbackRequestId = 0;
let previewedVoiceIds = new Set();
let selectedKeyframeId = null;
let selectedVoiceClipId = null;
let pendingSelectedKeyframePoseSave = false;
let activeJointDrawerGroupKey = null;

let projectState = createProjectState();
selectedKeyframeId = projectState.actionKeyframes[0]?.id || null;

function createDefaultStartKeyframe() {
  return {
    id: 'kf_start',
    label: '起始帧',
    time: 0,
    easing: 'easeInOut',
    isStart: true,
    pose: sanitizePoseSnapshot(),
  };
}

transformControls.addEventListener('dragging-changed', event => {
  transformDragging = event.value;
  syncInteractionState();
  if (!event.value) {
    syncBaseInputs();
  }
});

transformControls.addEventListener('objectChange', () => {
  syncBaseInputs();
  markSelectedKeyframePoseDirty();
});

function createProjectState(overrides = {}) {
  const actionKeyframes = Array.isArray(overrides.actionKeyframes) ? overrides.actionKeyframes.map(sanitizeKeyframe) : [];

  return {
    title: 'untitled_project',
    duration: DEFAULT_PROJECT_DURATION,
    controlHz: DEFAULT_CONTROL_HZ,
    topics: {
      motion: '/robot/motion_plan',
      voice: '/robot/tts_plan',
    },
    jointNames: [],
    actionKeyframes: [],
    voiceClips: [],
    playhead: 0,
    ...overrides,
    topics: {
      motion: '/robot/motion_plan',
      voice: '/robot/tts_plan',
      ...(overrides.topics || {}),
    },
    actionKeyframes: ensureStartKeyframe(actionKeyframes),
    voiceClips: Array.isArray(overrides.voiceClips) ? overrides.voiceClips.map(sanitizeVoiceClip) : [],
  };
}

function sanitizeKeyframe(frame) {
  return {
    id: frame.id || createId('kf'),
    label: String(frame.label || '关键帧').trim() || '关键帧',
    time: clampNumber(frame.time, 0, Number.MAX_SAFE_INTEGER, 0),
    easing: EASING_MAP[frame.easing] ? frame.easing : 'easeInOut',
    isStart: Boolean(frame.isStart),
    pose: sanitizePoseSnapshot(frame.pose),
  };
}

function ensureStartKeyframe(frames) {
  const nextFrames = [...frames]
    .map(frame => ({ ...frame, isStart: false }))
    .sort((left, right) => left.time - right.time);

  const startFrame = nextFrames.find(frame => Math.abs(frame.time) <= 0.0001);
  if (startFrame) {
    startFrame.time = 0;
    startFrame.isStart = true;
    startFrame.label = String(startFrame.label || '起始帧').trim() || '起始帧';
    return nextFrames;
  }

  return [createDefaultStartKeyframe(), ...nextFrames];
}

function isStartKeyframe(frame) {
  return Boolean(frame?.isStart);
}

function getSelectedKeyframe() {
  return projectState.actionKeyframes.find(frame => frame.id === selectedKeyframeId) || null;
}

function clearSelectedKeyframePoseDirty() {
  pendingSelectedKeyframePoseSave = false;
}

function markSelectedKeyframePoseDirty() {
  if (!currentRobot || !selectedKeyframeId || isPlaying) {
    return;
  }

  if (pendingSelectedKeyframePoseSave) {
    return;
  }

  const keyframe = getSelectedKeyframe();
  if (!keyframe) {
    return;
  }

  pendingSelectedKeyframePoseSave = true;
  setStatus(`关键帧 ${keyframe.label} 的姿态已修改，切换时会提示是否保存。`);
}

function saveSelectedKeyframePose(options = {}) {
  const { silent = false } = options;
  const keyframe = getSelectedKeyframe();
  if (!keyframe || !currentRobot) {
    clearSelectedKeyframePoseDirty();
    return false;
  }

  keyframe.pose = captureCurrentPoseSnapshot();
  clearSelectedKeyframePoseDirty();

  if (!silent) {
    setStatus(`已保存关键帧 ${keyframe.label} 的姿态。`);
  }

  return true;
}

function resolvePendingSelectedKeyframePose(reason = '切换到其他内容') {
  if (!pendingSelectedKeyframePoseSave) {
    return;
  }

  const keyframe = getSelectedKeyframe();
  if (!keyframe) {
    clearSelectedKeyframePoseDirty();
    return;
  }

  const shouldSave = window.confirm(`关键帧“${keyframe.label}”的姿态已修改，${reason}前要保存吗？`);
  if (shouldSave) {
    saveSelectedKeyframePose({ silent: true });
    return;
  }

  clearSelectedKeyframePoseDirty();
}

function selectKeyframe(frameId) {
  if (frameId === selectedKeyframeId) {
    return;
  }

  resolvePendingSelectedKeyframePose('离开当前关键帧');
  selectedKeyframeId = frameId;
  selectedVoiceClipId = null;
  const keyframe = getSelectedKeyframe();
  if (keyframe) {
    updatePlayhead(keyframe.time);
  }
  renderInspectors();
  renderActionTrack();
  renderVoiceTrack();
}

function selectVoiceClip(clipId) {
  if (clipId === selectedVoiceClipId) {
    return;
  }

  resolvePendingSelectedKeyframePose('切换到语音片段');
  selectedVoiceClipId = clipId;
  selectedKeyframeId = null;
  const clip = projectState.voiceClips.find(entry => entry.id === clipId);
  if (clip) {
    updatePlayhead(clip.start, { applyPose: false });
  }
  renderInspectors();
  renderVoiceTrack();
  renderActionTrack();
}

function sanitizeVoiceClip(clip) {
  return {
    id: clip.id || createId('vc'),
    start: clampNumber(clip.start, 0, Number.MAX_SAFE_INTEGER, 0),
    duration: clampNumber(clip.duration, 0.1, Number.MAX_SAFE_INTEGER, 2.5),
    text: String(clip.text || '').trim(),
    topic: String(clip.topic || '/robot/tts_plan').trim() || '/robot/tts_plan',
    voiceName: String(clip.voiceName || 'narration').trim() || 'narration',
  };
}

function sanitizePoseSnapshot(snapshot = {}) {
  return {
    base: {
      x: Number(snapshot.base?.x) || 0,
      y: Number(snapshot.base?.y) || 0,
      z: Number(snapshot.base?.z) || 0,
      yaw: Number(snapshot.base?.yaw) || 0,
    },
    joints: Object.fromEntries(
      Object.entries(snapshot.joints || {})
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([jointName, value]) => [jointName, Number(value)])
    ),
  };
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(numeric, min), max);
}

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

function setProjectPlaceholder(message) {
  projectPicker.innerHTML = '';
  const option = document.createElement('option');
  option.value = '';
  option.textContent = message;
  projectPicker.appendChild(option);
  projectPicker.disabled = true;
}

function formatAngle(value) {
  const degrees = THREE.MathUtils.radToDeg(value);
  return `${value.toFixed(3)} rad / ${degrees.toFixed(1)}°`;
}

function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(3).padStart(6, '0')}`;
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
  camera.position.set(3.2, -3.5, 2.2);
  orbitControls.target.set(0, 0, 0.95);
  orbitControls.update();
}

function applyRobotMaterials(robot) {
  robot.traverse(object => {
    if (!object.isMesh) {
      return;
    }
    const originalScale = object.scale.clone();
    object.material = new THREE.MeshStandardMaterial({
      color: '#d9f0ff',
      emissive: '#0b2e3a',
      emissiveIntensity: 0.2,
      roughness: 0.55,
      metalness: 0.18,
      side: THREE.DoubleSide,
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
  jointWidgets.clear();
  jointListNode.innerHTML = '<div class="empty-state">模型加载后，这里会生成身体模块按钮。点击一个模块后，会从右侧展开对应的关节控制抽屉。</div>';
  jointCountNode.textContent = '0 joints';
  closeJointDrawer();
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
    if (typeof event?.pointerId === 'number') {
      try {
        slider.releasePointerCapture?.(event.pointerId);
      } catch {
        // Ignore release failures when the pointer is already gone.
      }
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
    return { key: 'lower-body', label: '下肢', order: 1 };
  }
  if (normalized.includes('waist')) {
    return { key: 'waist', label: '腰部', order: 2 };
  }
  if (normalized.includes('left_')) {
    return { key: 'left-arm', label: '左臂', order: 3 };
  }
  if (normalized.includes('right_')) {
    return { key: 'right-arm', label: '右臂', order: 4 };
  }
  if (normalized.includes('neck') || normalized.includes('head')) {
    return { key: 'neck', label: '头颈', order: 5 };
  }
  return { key: 'other', label: '其他', order: 6 };
}

function groupJoints(joints) {
  const groups = new Map();
  for (const joint of joints) {
    const group = getJointGroup(joint.name);
    if (!groups.has(group.key)) {
      groups.set(group.key, { ...group, joints: [] });
    }
    groups.get(group.key).joints.push(joint);
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      joints: group.joints.sort(compareJointsByUrdfOrder),
      firstIndex: Math.min(...group.joints.map(joint => jointOrderIndex.get(joint.name) ?? Number.MAX_SAFE_INTEGER)),
    }))
    .sort((left, right) => {
      if (left.firstIndex !== right.firstIndex) {
        return left.firstIndex - right.firstIndex;
      }
      return left.order - right.order;
    });
}

function updateJointWidget(jointName, value) {
  const widget = jointWidgets.get(jointName);
  if (!widget) {
    return;
  }
  widget.slider.value = String(value);
  widget.valueNode.textContent = formatAngle(value);
}

function formatJointDisplayName(jointName) {
  return jointName
    .replace(/^Joint_/, '')
    .replace(/^joint_/i, '')
    .replace(/_/g, ' ')
    .trim();
}

function getJointGroups() {
  return groupJoints([...jointControllers]);
}

function getJointGroupByKey(groupKey) {
  return getJointGroups().find(group => group.key === groupKey) || null;
}

function closeJointDrawer() {
  activeJointDrawerGroupKey = null;
  jointWidgets.clear();
  jointDrawer.classList.remove('open');
  jointDrawerBackdrop.classList.remove('open');
  jointDrawer.setAttribute('aria-hidden', 'true');
  jointDrawerBody.innerHTML = '';
  renderJointModuleButtons();
}

function openJointDrawer(groupKey) {
  activeJointDrawerGroupKey = groupKey;
  renderJointModuleButtons();
  renderJointDrawer();
}

function renderJointModuleButtons() {
  const groups = getJointGroups();
  if (groups.length === 0) {
    jointListNode.innerHTML = '<div class="empty-state">当前模型没有可直接控制的关节。</div>';
    return;
  }

  jointListNode.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'joint-module-grid';

  for (const group of groups) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `joint-module-button${group.key === activeJointDrawerGroupKey ? ' active' : ''}`;
    const previewNames = group.joints.slice(0, 3).map(joint => formatJointDisplayName(joint.name)).join(' / ');
    button.innerHTML = `
      <strong>${group.label}</strong>
      <span>${group.joints.length} 个关节</span>
      <small>${previewNames}</small>
    `;
    button.addEventListener('click', () => {
      if (activeJointDrawerGroupKey === group.key) {
        closeJointDrawer();
        return;
      }
      openJointDrawer(group.key);
    });
    grid.appendChild(button);
  }

  jointListNode.appendChild(grid);
}

function renderJointDrawer() {
  const group = getJointGroupByKey(activeJointDrawerGroupKey);
  if (!group) {
    closeJointDrawer();
    return;
  }

  jointWidgets.clear();
  jointDrawer.classList.add('open');
  jointDrawerBackdrop.classList.add('open');
  jointDrawer.setAttribute('aria-hidden', 'false');
  jointDrawerTitle.textContent = `${group.label}关节控制`;
  jointDrawerMeta.textContent = `当前模块共 ${group.joints.length} 个关节，可在这里集中调节。`;
  jointDrawerBody.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'joint-drawer-list';
  for (const joint of group.joints) {
    list.appendChild(createJointCard(joint));
  }

  jointDrawerBody.appendChild(list);
}

function createJointCard(joint) {
  const lower = Number.isFinite(joint.limit?.lower) ? joint.limit.lower : -Math.PI;
  const upper = Number.isFinite(joint.limit?.upper) ? joint.limit.upper : Math.PI;
  const initial = Number.isFinite(joint.angle) ? joint.angle : 0;

  const card = document.createElement('article');
  card.className = 'joint-card';
  card.innerHTML = `
    <header>
      <div>
        <h3>${formatJointDisplayName(joint.name)}</h3>
        <p class="joint-name">${joint.name}</p>
      </div>
      <span class="joint-value">${formatAngle(initial)}</span>
    </header>
    <input type="range" min="${lower}" max="${upper}" step="0.001" value="${initial}" />
    <p class="joint-meta">范围: ${formatAngle(lower)} ~ ${formatAngle(upper)}</p>
  `;

  const valueNode = card.querySelector('.joint-value');
  const slider = card.querySelector('input');
  jointWidgets.set(joint.name, { slider, valueNode });
  attachSliderInteractionGuards(slider);

  slider.addEventListener('input', event => {
    const nextValue = Number(event.currentTarget.value);
    joint.setJointValue(nextValue);
    valueNode.textContent = formatAngle(nextValue);
    markSelectedKeyframePoseDirty();
  });

  return card;
}

function updateRobotTransform() {
  robotGroup.position.set(baseState.x, baseState.y, baseState.z);
  robotGroup.rotation.set(0, 0, baseState.yaw);
  robotGroup.updateMatrixWorld(true);
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
    <p class="joint-meta">${key === 'yaw' ? '基座偏航' : '基座平移'}</p>
  `;

  const input = card.querySelector('input');
  const valueNode = card.querySelector('.joint-value');
  baseInputs.set(key, input);
  attachSliderInteractionGuards(input);

  input.addEventListener('input', event => {
    baseState[key] = Number(event.currentTarget.value);
    updateRobotTransform();
    valueNode.textContent = key === 'yaw' ? formatAngle(baseState[key]) : `${baseState[key].toFixed(3)} m`;
    markSelectedKeyframePoseDirty();
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
  projectState.jointNames = joints.map(joint => joint.name);
  jointCountNode.textContent = `${joints.length} joints`;

  if (activeJointDrawerGroupKey && !getJointGroupByKey(activeJointDrawerGroupKey)) {
    activeJointDrawerGroupKey = null;
  }

  renderJointModuleButtons();
  if (activeJointDrawerGroupKey) {
    renderJointDrawer();
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

  camera.position.set(radius * 1.7, -radius * 2.2, radius * 1.32);
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

async function fetchSavedProjects(preferredFileName = '') {
  const response = await fetch('/api/projects');
  if (!response.ok) {
    throw new Error(`Projects request failed: ${response.status}`);
  }
  const result = await response.json();
  savedProjects = Array.isArray(result.projects) ? result.projects : [];
  populateProjectOptions(preferredFileName);
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

function populateProjectOptions(preferredFileName = '') {
  if (savedProjects.length === 0) {
    setProjectPlaceholder('暂无已保存项目');
    return;
  }

  projectPicker.innerHTML = '';
  projectPicker.disabled = false;

  for (const project of savedProjects) {
    const option = document.createElement('option');
    option.value = project.fileName;
    option.textContent = project.title || project.fileName;
    projectPicker.appendChild(option);
  }

  const selectedFileName = preferredFileName && savedProjects.some(project => project.fileName === preferredFileName)
    ? preferredFileName
    : savedProjects[0].fileName;

  projectPicker.value = selectedFileName;
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

    const previewPose = evaluatePoseAtTime(projectState.playhead);
    if (previewPose) {
      applyPoseSnapshot(previewPose);
    }

    setStatus(`已加载 ${modelSelect.value} / ${fileSelect.value}，meshes: ${meshCount}，size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}，radius: ${radius.toFixed(2)}`);
  } catch (error) {
    console.error(error);
    setStatus(`模型加载失败: ${error.message}`, true);
  }
}

function buildPosePayload() {
  const jointMap = new Map(jointControllers.map(joint => [joint.name, Number.isFinite(joint.angle) ? joint.angle : 0]));
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
      const radians = THREE.MathUtils.degToRad(degrees);
      joint.setJointValue(radians);
      updateJointWidget(jointName, radians);
      appliedCount += 1;
    });
  }

  if (appliedCount === 0) {
    setStatus('动作加载失败: 当前文件中没有可应用的关节数据。', true);
    return;
  }

  const selectedAction = savedActions.find(action => action.fileName === savedActionSelect.value);
  markSelectedKeyframePoseDirty();
  setStatus(`已加载动作: ${selectedAction?.title || savedActionSelect.value}，已应用 ${appliedCount} 个关节。`);
}

function captureCurrentPoseSnapshot() {
  const joints = Object.fromEntries(jointControllers.map(joint => [joint.name, Number.isFinite(joint.angle) ? joint.angle : 0]));
  return {
    base: { ...baseState },
    joints,
  };
}

function applyPoseSnapshot(snapshot) {
  if (!snapshot || !currentRobot) {
    return;
  }

  Object.assign(baseState, {
    x: Number(snapshot.base?.x) || 0,
    y: Number(snapshot.base?.y) || 0,
    z: Number(snapshot.base?.z) || 0,
    yaw: Number(snapshot.base?.yaw) || 0,
  });
  updateRobotTransform();
  syncBaseInputs();

  const jointMap = new Map(jointControllers.map(joint => [joint.name, joint]));
  for (const [jointName, angle] of Object.entries(snapshot.joints || {})) {
    const joint = jointMap.get(jointName);
    if (!joint) {
      continue;
    }
    const nextAngle = Number(angle) || 0;
    joint.setJointValue(nextAngle);
    updateJointWidget(jointName, nextAngle);
  }

  currentRobot.updateMatrixWorld(true);
  robotGroup.updateMatrixWorld(true);
}

function sortKeyframes() {
  projectState.actionKeyframes.sort((left, right) => left.time - right.time);
  projectState.actionKeyframes = ensureStartKeyframe(projectState.actionKeyframes);
}

function sortVoiceClips() {
  projectState.voiceClips.sort((left, right) => left.start - right.start);
}

function findCloseKeyframe(time) {
  return projectState.actionKeyframes.find(frame => Math.abs(frame.time - time) <= 0.02) || null;
}

function insertKeyframeFromCurrentPose() {
  if (!currentRobot) {
    setStatus('当前没有已加载的机器人模型，无法插入关键帧。', true);
    return;
  }

  const existing = findCloseKeyframe(projectState.playhead);
  const pose = captureCurrentPoseSnapshot();
  if (existing) {
    existing.pose = pose;
    selectedKeyframeId = existing.id;
    renderComposer();
    setStatus(`已覆盖 ${existing.label} 的姿态内容。`);
    return;
  }

  const nextFrame = {
    id: createId('kf'),
    label: `关键帧 ${projectState.actionKeyframes.filter(frame => !isStartKeyframe(frame)).length + 1}`,
    time: projectState.playhead,
    easing: 'easeInOut',
    pose,
  };

  projectState.actionKeyframes.push(nextFrame);
  sortKeyframes();
  selectedKeyframeId = nextFrame.id;
  renderComposer();
  setStatus(`已在 ${projectState.playhead.toFixed(3)}s 插入关键帧。`);
}

function updateSelectedKeyframePose() {
  const keyframe = getSelectedKeyframe();
  if (!keyframe) {
    setStatus('请先选中一个关键帧。', true);
    return;
  }

  saveSelectedKeyframePose({ silent: true });
  renderComposer();
  setStatus(`已覆盖关键帧 ${keyframe.label}。`);
}

function deleteSelectedKeyframe() {
  const keyframe = getSelectedKeyframe();
  if (isStartKeyframe(keyframe)) {
    setStatus('起始帧固定在 0s，不能删除，但可以直接覆盖它的姿态。', true);
    return;
  }

  const before = projectState.actionKeyframes.length;
  projectState.actionKeyframes = projectState.actionKeyframes.filter(frame => frame.id !== selectedKeyframeId);
  if (projectState.actionKeyframes.length === before) {
    setStatus('没有可删除的关键帧。', true);
    return;
  }
  selectedKeyframeId = null;
  clearSelectedKeyframePoseDirty();
  renderComposer();
  setStatus('已删除关键帧。');
}

function addVoiceClip() {
  const text = voiceTextInput.value.trim();
  const duration = clampNumber(voiceDurationInput.value, 0.1, 120, 2.5);
  const voiceName = voiceNameInput.value.trim() || 'narration';

  if (!text) {
    setStatus('语音文本不能为空。', true);
    return;
  }

  const clip = {
    id: createId('vc'),
    start: projectState.playhead,
    duration,
    text,
    topic: projectState.topics.voice,
    voiceName,
  };

  projectState.voiceClips.push(clip);
  sortVoiceClips();
  selectedVoiceClipId = clip.id;
  renderComposer();
  setStatus(`已在 ${clip.start.toFixed(3)}s 插入语音片段。`);
}

function deleteSelectedVoiceClip() {
  const before = projectState.voiceClips.length;
  projectState.voiceClips = projectState.voiceClips.filter(clip => clip.id !== selectedVoiceClipId);
  if (projectState.voiceClips.length === before) {
    setStatus('没有可删除的语音片段。', true);
    return;
  }
  selectedVoiceClipId = null;
  renderComposer();
  setStatus('已删除语音片段。');
}

function interpolatePoseSnapshots(leftPose, rightPose, rawProgress, easingName = 'easeInOut') {
  const easing = EASING_MAP[easingName] || EASING_MAP.easeInOut;
  const progress = easing(THREE.MathUtils.clamp(rawProgress, 0, 1));

  const jointNames = new Set([...Object.keys(leftPose.joints || {}), ...Object.keys(rightPose.joints || {})]);
  const joints = {};

  for (const jointName of jointNames) {
    const leftValue = Number(leftPose.joints?.[jointName]) || 0;
    const rightValue = Number(rightPose.joints?.[jointName]) || 0;
    joints[jointName] = THREE.MathUtils.lerp(leftValue, rightValue, progress);
  }

  return {
    base: {
      x: THREE.MathUtils.lerp(Number(leftPose.base?.x) || 0, Number(rightPose.base?.x) || 0, progress),
      y: THREE.MathUtils.lerp(Number(leftPose.base?.y) || 0, Number(rightPose.base?.y) || 0, progress),
      z: THREE.MathUtils.lerp(Number(leftPose.base?.z) || 0, Number(rightPose.base?.z) || 0, progress),
      yaw: THREE.MathUtils.lerp(Number(leftPose.base?.yaw) || 0, Number(rightPose.base?.yaw) || 0, progress),
    },
    joints,
  };
}

function evaluatePoseAtTime(time) {
  const frames = [...projectState.actionKeyframes].sort((left, right) => left.time - right.time);
  if (frames.length === 0) {
    return null;
  }
  if (time <= frames[0].time) {
    return sanitizePoseSnapshot(frames[0].pose);
  }

  for (let index = 0; index < frames.length - 1; index += 1) {
    const leftFrame = frames[index];
    const rightFrame = frames[index + 1];
    if (time >= leftFrame.time && time <= rightFrame.time) {
      const segmentDuration = Math.max(rightFrame.time - leftFrame.time, 0.0001);
      const progress = (time - leftFrame.time) / segmentDuration;
      return interpolatePoseSnapshots(
        sanitizePoseSnapshot(leftFrame.pose),
        sanitizePoseSnapshot(rightFrame.pose),
        progress,
        leftFrame.easing,
      );
    }
  }

  return sanitizePoseSnapshot(frames[frames.length - 1].pose);
}

function updatePlayhead(nextTime, options = {}) {
  const { applyPose = true } = options;
  projectState.playhead = clampNumber(nextTime, 0, projectState.duration, 0);
  playheadLabel.textContent = formatTime(projectState.playhead);
  currentTimeChip.textContent = `${projectState.playhead.toFixed(3)}s`;
  const playheadLeft = `${projectState.playhead * TIMELINE_PIXELS_PER_SECOND}px`;
  for (const node of [timelineBoard, timelineRuler, actionTrack, voiceTrack]) {
    node.style.setProperty('--playhead-left', playheadLeft);
  }

  if (applyPose) {
    const pose = evaluatePoseAtTime(projectState.playhead);
    if (pose) {
      applyPoseSnapshot(pose);
    }
  }
}

function processVoicePreview(previousTime, nextTime) {
  if (!browserVoiceToggle.checked || typeof window.speechSynthesis === 'undefined') {
    return;
  }

  for (const clip of projectState.voiceClips) {
    if (previewedVoiceIds.has(clip.id)) {
      continue;
    }
    if (clip.start >= previousTime && clip.start < nextTime) {
      const utterance = new SpeechSynthesisUtterance(clip.text);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
      previewedVoiceIds.add(clip.id);
    }
  }
}

function stopPlayback(options = {}) {
  const { keepCurrentTime = true } = options;
  isPlaying = false;
  playToggleButton.textContent = '播放';
  playToggleButton.classList.remove('playing');

  if (playbackRequestId) {
    cancelAnimationFrame(playbackRequestId);
    playbackRequestId = 0;
  }

  previewedVoiceIds = new Set();
  if (typeof window.speechSynthesis !== 'undefined') {
    window.speechSynthesis.cancel();
  }

  if (!keepCurrentTime) {
    updatePlayhead(0);
  }
}

function playbackTick(timestamp) {
  if (!isPlaying) {
    return;
  }

  const elapsed = (timestamp - playbackStartedAt) / 1000;
  const nextTime = Math.min(playbackFromTime + elapsed, projectState.duration);
  processVoicePreview(lastPlaybackTime, nextTime + 0.0001);
  lastPlaybackTime = nextTime;
  updatePlayhead(nextTime, { applyPose: true });

  if (nextTime >= projectState.duration) {
    stopPlayback({ keepCurrentTime: true });
    return;
  }

  playbackRequestId = requestAnimationFrame(playbackTick);
}

function togglePlayback() {
  if (isPlaying) {
    stopPlayback({ keepCurrentTime: true });
    return;
  }

  resolvePendingSelectedKeyframePose('开始播放预览');

  if (projectState.playhead >= projectState.duration) {
    updatePlayhead(0);
  }

  isPlaying = true;
  playbackFromTime = projectState.playhead;
  lastPlaybackTime = playbackFromTime;
  playbackStartedAt = performance.now();
  previewedVoiceIds = new Set();
  playToggleButton.textContent = '暂停';
  playToggleButton.classList.add('playing');
  playbackRequestId = requestAnimationFrame(playbackTick);
}

function buildExportPlan() {
  const totalSamples = Math.floor(projectState.duration * projectState.controlHz) + 1;
  const samples = [];

  for (let index = 0; index < totalSamples; index += 1) {
    const time = Math.min(index / projectState.controlHz, projectState.duration);
    const pose = evaluatePoseAtTime(time);
    if (!pose) {
      continue;
    }
    samples.push({
      time: Number(time.toFixed(3)),
      base: {
        x: Number((pose.base.x || 0).toFixed(6)),
        y: Number((pose.base.y || 0).toFixed(6)),
        z: Number((pose.base.z || 0).toFixed(6)),
        yaw: Number((pose.base.yaw || 0).toFixed(6)),
      },
      joints: Object.fromEntries(
        Object.entries(pose.joints || {}).map(([jointName, angle]) => [jointName, Number((angle || 0).toFixed(6))])
      ),
    });
  }

  return {
    meta: {
      title: projectState.title,
      duration: projectState.duration,
      controlHz: projectState.controlHz,
      generatedAt: new Date().toISOString(),
      model: modelSelect.value,
      file: fileSelect.value,
    },
    topics: { ...projectState.topics },
    motionPlan: {
      topic: projectState.topics.motion,
      sampleHz: projectState.controlHz,
      frames: samples,
    },
    voicePlan: {
      topic: projectState.topics.voice,
      clips: projectState.voiceClips.map(clip => ({
        id: clip.id,
        start: Number(clip.start.toFixed(3)),
        duration: Number(clip.duration.toFixed(3)),
        text: clip.text,
        topic: clip.topic,
        voiceName: clip.voiceName,
      })),
    },
  };
}

function syncProjectFieldsFromState() {
  projectTitleInput.value = projectState.title;
  projectDurationInput.value = String(projectState.duration);
  durationQuickInput.value = String(projectState.duration);
  controlHzInput.value = String(projectState.controlHz);
  motionTopicInput.value = projectState.topics.motion;
  voiceTopicInput.value = projectState.topics.voice;
  durationLabel.textContent = formatTime(projectState.duration);
}

function updateProjectDuration(nextDuration) {
  const safeDuration = clampNumber(nextDuration, PROJECT_MIN_DURATION, 600, DEFAULT_PROJECT_DURATION);
  projectDurationInput.value = String(safeDuration);
  durationQuickInput.value = String(safeDuration);
  renderComposer();
}

function syncStateFromProjectFields() {
  projectState.title = projectTitleInput.value.trim() || 'untitled_project';
  projectState.duration = clampNumber(projectDurationInput.value, PROJECT_MIN_DURATION, 600, DEFAULT_PROJECT_DURATION);
  projectState.controlHz = clampNumber(controlHzInput.value, 1, 500, DEFAULT_CONTROL_HZ);
  projectState.topics.motion = motionTopicInput.value.trim() || '/robot/motion_plan';
  projectState.topics.voice = voiceTopicInput.value.trim() || '/robot/tts_plan';

  for (const clip of projectState.voiceClips) {
    if (!clip.topic) {
      clip.topic = projectState.topics.voice;
    }
  }

  if (projectState.playhead > projectState.duration) {
    updatePlayhead(projectState.duration);
  }
}

function renderTimelineRuler() {
  const totalWidth = Math.max(projectState.duration * TIMELINE_PIXELS_PER_SECOND, 480);
  timelineRuler.innerHTML = '';
  timelineRuler.style.width = `${totalWidth}px`;

  const totalTicks = Math.ceil(projectState.duration);
  for (let second = 0; second <= totalTicks; second += 1) {
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'ruler-tick';
    tick.style.left = `${second * TIMELINE_PIXELS_PER_SECOND}px`;
    tick.innerHTML = `<span>${second}s</span>`;
    tick.addEventListener('click', () => {
      resolvePendingSelectedKeyframePose('移动播放头');
      updatePlayhead(second);
    });
    timelineRuler.appendChild(tick);
  }
}

function bindTrackSeek(node) {
  const setPlayheadFromEvent = event => {
    resolvePendingSelectedKeyframePose('移动播放头');
    const rect = node.getBoundingClientRect();
    const offsetX = THREE.MathUtils.clamp(event.clientX - rect.left, 0, rect.width);
    const nextTime = offsetX / TIMELINE_PIXELS_PER_SECOND;
    updatePlayhead(nextTime);
  };

  node.addEventListener('pointerdown', event => {
    if (event.target.closest('.track-item')) {
      return;
    }

    setPlayheadFromEvent(event);
    const move = moveEvent => setPlayheadFromEvent(moveEvent);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  });
}

function renderActionTrack() {
  const totalWidth = Math.max(projectState.duration * TIMELINE_PIXELS_PER_SECOND, 480);
  const frames = [...projectState.actionKeyframes].sort((left, right) => left.time - right.time);
  actionTrack.innerHTML = '';
  actionTrack.style.width = `${totalWidth}px`;

  for (let index = 0; index < frames.length - 1; index += 1) {
    const currentFrame = frames[index];
    const nextFrame = frames[index + 1];
    const segment = document.createElement('div');
    segment.className = 'keyframe-segment';
    segment.style.left = `${currentFrame.time * TIMELINE_PIXELS_PER_SECOND}px`;
    segment.style.width = `${Math.max((nextFrame.time - currentFrame.time) * TIMELINE_PIXELS_PER_SECOND, 0)}px`;
    actionTrack.appendChild(segment);
  }

  for (const frame of frames) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `track-item keyframe-item${isStartKeyframe(frame) ? ' start-keyframe' : ''}${frame.id === selectedKeyframeId ? ' selected' : ''}`;
    node.style.left = `${frame.time * TIMELINE_PIXELS_PER_SECOND}px`;
    node.innerHTML = `
      <strong>${frame.label}</strong>
      <span>${frame.time.toFixed(3)}s</span>
      <small>${frame.easing}</small>
    `;
    node.addEventListener('pointerdown', event => {
      event.stopPropagation();
    });
    node.addEventListener('click', event => {
      event.stopPropagation();
      selectKeyframe(frame.id);
    });
    actionTrack.appendChild(node);
  }
}

function renderVoiceTrack() {
  const totalWidth = Math.max(projectState.duration * TIMELINE_PIXELS_PER_SECOND, 480);
  voiceTrack.innerHTML = '';
  voiceTrack.style.width = `${totalWidth}px`;

  for (const clip of [...projectState.voiceClips].sort((left, right) => left.start - right.start)) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `track-item voice-item${clip.id === selectedVoiceClipId ? ' selected' : ''}`;
    node.style.left = `${clip.start * TIMELINE_PIXELS_PER_SECOND}px`;
    node.style.width = `${Math.max(clip.duration * TIMELINE_PIXELS_PER_SECOND, 72)}px`;
    node.innerHTML = `
      <strong>${clip.voiceName}</strong>
      <span>${clip.text || '未命名语音'}</span>
      <small>${clip.start.toFixed(3)}s / ${clip.duration.toFixed(2)}s</small>
    `;
    node.addEventListener('pointerdown', event => {
      event.stopPropagation();
    });
    node.addEventListener('click', event => {
      event.stopPropagation();
      selectVoiceClip(clip.id);
    });
    voiceTrack.appendChild(node);
  }
}

function renderKeyframeInspector() {
  const keyframe = projectState.actionKeyframes.find(frame => frame.id === selectedKeyframeId);
  if (!keyframe) {
    keyframeInspector.className = 'inspector-body empty-state';
    keyframeInspector.textContent = '选中一个关键帧后，可修改时间、标签和 easing，也可以在当前姿态上覆盖它。';
    return;
  }

  const startFrame = isStartKeyframe(keyframe);

  keyframeInspector.className = 'inspector-body';
  keyframeInspector.innerHTML = `
    <div class="field">
      <label for="kf-label">标签</label>
      <input id="kf-label" type="text" value="${keyframe.label}" />
    </div>
    <div class="control-grid">
      <div class="field">
        <label for="kf-time">时间 (s)</label>
        <input id="kf-time" type="number" min="0" max="${projectState.duration}" step="0.001" value="${keyframe.time}" ${startFrame ? 'disabled' : ''} />
      </div>
      <div class="field">
        <label for="kf-easing">Easing</label>
        <select id="kf-easing">
          ${Object.keys(EASING_MAP).map(name => `<option value="${name}" ${name === keyframe.easing ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="inspector-stats">
      <span>基座: x ${keyframe.pose.base.x.toFixed(2)}, y ${keyframe.pose.base.y.toFixed(2)}, z ${keyframe.pose.base.z.toFixed(2)}, yaw ${keyframe.pose.base.yaw.toFixed(2)}</span>
      <span>关节采样: ${Object.keys(keyframe.pose.joints || {}).length}</span>
    </div>
  `;

  keyframeInspector.querySelector('#kf-label').addEventListener('input', event => {
    keyframe.label = event.currentTarget.value.trim() || '关键帧';
    renderActionTrack();
  });

  const timeInput = keyframeInspector.querySelector('#kf-time');
  if (!startFrame) {
    timeInput.addEventListener('change', event => {
      keyframe.time = clampNumber(event.currentTarget.value, 0, projectState.duration, keyframe.time);
      sortKeyframes();
      updatePlayhead(keyframe.time);
      renderComposer();
    });
  }

  keyframeInspector.querySelector('#kf-easing').addEventListener('change', event => {
    keyframe.easing = event.currentTarget.value;
    renderActionTrack();
  });
}

function renderVoiceInspector() {
  const clip = projectState.voiceClips.find(entry => entry.id === selectedVoiceClipId);
  if (!clip) {
    voiceInspector.className = 'inspector-body empty-state';
    voiceInspector.textContent = '插入语音片段后，可修改开始时间、文本和持续时长。';
    return;
  }

  voiceInspector.className = 'inspector-body';
  voiceInspector.innerHTML = `
    <div class="control-grid">
      <div class="field">
        <label for="vc-start">开始时间 (s)</label>
        <input id="vc-start" type="number" min="0" max="${projectState.duration}" step="0.001" value="${clip.start}" />
      </div>
      <div class="field">
        <label for="vc-duration">时长 (s)</label>
        <input id="vc-duration" type="number" min="0.1" step="0.1" value="${clip.duration}" />
      </div>
    </div>
    <div class="field">
      <label for="vc-name">语音名</label>
      <input id="vc-name" type="text" value="${clip.voiceName}" />
    </div>
    <div class="field">
      <label for="vc-text">文本</label>
      <textarea id="vc-text" rows="4">${clip.text}</textarea>
    </div>
  `;

  voiceInspector.querySelector('#vc-start').addEventListener('change', event => {
    clip.start = clampNumber(event.currentTarget.value, 0, projectState.duration, clip.start);
    sortVoiceClips();
    renderComposer();
  });

  voiceInspector.querySelector('#vc-duration').addEventListener('change', event => {
    clip.duration = clampNumber(event.currentTarget.value, 0.1, 120, clip.duration);
    renderComposer();
  });

  voiceInspector.querySelector('#vc-name').addEventListener('input', event => {
    clip.voiceName = event.currentTarget.value.trim() || 'narration';
    renderVoiceTrack();
  });

  voiceInspector.querySelector('#vc-text').addEventListener('input', event => {
    clip.text = event.currentTarget.value.trim();
    renderVoiceTrack();
  });
}

function renderInspectors() {
  renderKeyframeInspector();
  renderVoiceInspector();
}

function renderSummary() {
  keyframeCountNode.textContent = String(projectState.actionKeyframes.length);
  voiceCountNode.textContent = String(projectState.voiceClips.length);
  const totalSamples = Math.floor(projectState.duration * projectState.controlHz) + 1;
  sampleCountChip.textContent = `${totalSamples} samples`;
  durationLabel.textContent = formatTime(projectState.duration);
}

function renderComposer() {
  syncStateFromProjectFields();
  renderTimelineRuler();
  renderActionTrack();
  renderVoiceTrack();
  renderInspectors();
  renderSummary();
  updatePlayhead(projectState.playhead, { applyPose: Boolean(currentRobot) });
}

function buildProjectPayload() {
  resolvePendingSelectedKeyframePose('保存项目');
  syncStateFromProjectFields();
  return {
    title: projectState.title,
    duration: projectState.duration,
    controlHz: projectState.controlHz,
    topics: { ...projectState.topics },
    jointNames: [...projectState.jointNames],
    actionKeyframes: projectState.actionKeyframes.map(frame => ({
      id: frame.id,
      label: frame.label,
      time: Number(frame.time.toFixed(3)),
      easing: frame.easing,
      isStart: isStartKeyframe(frame),
      pose: sanitizePoseSnapshot(frame.pose),
    })),
    voiceClips: projectState.voiceClips.map(clip => ({
      id: clip.id,
      start: Number(clip.start.toFixed(3)),
      duration: Number(clip.duration.toFixed(3)),
      text: clip.text,
      topic: clip.topic,
      voiceName: clip.voiceName,
    })),
  };
}

function loadProjectPayload(payload) {
  resolvePendingSelectedKeyframePose('加载其他项目');
  stopPlayback({ keepCurrentTime: false });
  projectState = createProjectState(payload);
  selectedKeyframeId = projectState.actionKeyframes[0]?.id || null;
  selectedVoiceClipId = null;
  clearSelectedKeyframePoseDirty();
  syncProjectFieldsFromState();
  renderComposer();
}

async function saveProject() {
  const payload = buildProjectPayload();

  try {
    const response = await fetch('/api/save-project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Save request failed: ${response.status}`);
    }

    const result = await response.json();
    await fetchSavedProjects(result.fileName);
    setStatus(`项目已保存: ${result.path}`);
  } catch (error) {
    console.error(error);
    setStatus(`项目保存失败: ${error.message}`, true);
  }
}

function downloadJson(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportPlan() {
  resolvePendingSelectedKeyframePose('导出计划');
  if (projectState.actionKeyframes.length === 0) {
    setStatus('至少需要一个关键帧后才能导出运动计划。', true);
    return;
  }

  const payload = buildExportPlan();
  const safeTitle = projectState.title.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'robot_plan';
  downloadJson(`${safeTitle}_100hz_plan.json`, payload);
  setStatus(`已导出 100Hz 计划，共 ${payload.motionPlan.frames.length} 帧。`);
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

async function refreshSavedProjects(options = {}) {
  const { silent = false, preferredFileName = '' } = options;
  try {
    await fetchSavedProjects(preferredFileName);
    if (!silent) {
      setStatus(`已刷新项目列表，共 ${savedProjects.length} 个项目。`);
    }
  } catch (error) {
    console.error(error);
    setProjectPlaceholder('项目列表读取失败');
    setStatus(`项目列表读取失败: ${error.message}`, true);
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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: trimmedTitle,
        ...buildPosePayload(),
      }),
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

  Object.assign(baseState, { x: 0, y: 0, z: 0, yaw: 0 });
  updateRobotTransform();
  syncBaseInputs();

  for (const joint of jointControllers) {
    joint.setJointValue(0);
    updateJointWidget(joint.name, 0);
  }

  markSelectedKeyframePoseDirty();
}

function isEditableElement(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
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

function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  renderer.render(scene, camera);
}

modelSelect.addEventListener('change', () => {
  resolvePendingSelectedKeyframePose('切换机器人型号');
  populateFileOptions();
  loadRobot();
});

fileSelect.addEventListener('change', () => {
  resolvePendingSelectedKeyframePose('切换 URDF 文件');
  loadRobot();
});

projectPicker.addEventListener('change', () => {
  const selected = savedProjects.find(project => project.fileName === projectPicker.value);
  if (!selected) {
    return;
  }
  loadProjectPayload(selected.payload || {});
  setStatus(`已加载项目: ${selected.title || selected.fileName}`);
});

reloadButton.addEventListener('click', () => loadRobot());
dragToggleButton.addEventListener('click', () => toggleDragMode());
resetCameraButton.addEventListener('click', () => resetCamera());
resetPoseButton.addEventListener('click', () => resetPose());
playToggleButton.addEventListener('click', () => togglePlayback());
stopPlaybackButton.addEventListener('click', () => stopPlayback({ keepCurrentTime: false }));
savePoseButton.addEventListener('click', () => saveCurrentPose());
loadActionButton.addEventListener('click', () => loadSelectedAction());
refreshActionsButton.addEventListener('click', () => refreshSavedActions());
insertKeyframeButton.addEventListener('click', () => insertKeyframeFromCurrentPose());
updateKeyframeButton.addEventListener('click', () => updateSelectedKeyframePose());
deleteKeyframeButton.addEventListener('click', () => deleteSelectedKeyframe());
addVoiceClipButton.addEventListener('click', () => addVoiceClip());
deleteVoiceClipButton.addEventListener('click', () => deleteSelectedVoiceClip());
saveProjectButton.addEventListener('click', () => saveProject());
exportPlanButton.addEventListener('click', () => exportPlan());
durationQuickInput.addEventListener('change', event => updateProjectDuration(event.currentTarget.value));
extendDurationButton.addEventListener('click', () => updateProjectDuration(projectState.duration + 5));

for (const input of [projectTitleInput, projectDurationInput, controlHzInput, motionTopicInput, voiceTopicInput]) {
  input.addEventListener('input', () => renderComposer());
}

jointDrawerCloseButton.addEventListener('click', () => closeJointDrawer());
jointDrawerBackdrop.addEventListener('click', () => closeJointDrawer());

window.addEventListener('resize', () => resizeRenderer());
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeJointDrawerGroupKey) {
    closeJointDrawer();
    return;
  }

  if (event.code !== 'Space' || event.repeat || isEditableElement(event.target)) {
    return;
  }

  event.preventDefault();
  togglePlayback();
});

bindTrackSeek(timelineRuler);
bindTrackSeek(actionTrack);
bindTrackSeek(voiceTrack);

async function init() {
  buildBaseControls();
  resetCamera();
  resizeRenderer();
  syncProjectFieldsFromState();
  renderComposer();
  animate();

  try {
    await fetchManifest();
    await Promise.all([
      refreshSavedActions({ silent: true }),
      refreshSavedProjects({ silent: true }),
    ]);
    populateModelOptions();
    await loadRobot();
    setStatus('创作平台已就绪。可以先摆姿态，再往动作轨插入关键帧。');
  } catch (error) {
    console.error(error);
    setStatus(`初始化失败: ${error.message}`, true);
  }
}

init();
