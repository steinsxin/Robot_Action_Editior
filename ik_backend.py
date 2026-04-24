from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import numpy as np
import pinocchio as pin

from autolife_robot_sdk import ROBOT_URDF_PATH


PROJECT_ROOT = Path(__file__).resolve().parent
ARM_IK_SOLVER_PATH = PROJECT_ROOT.parent / "AutolifeRobotArm" / "src" / "autolife_robot_arm" / "ik_solver.py"

LEFT_TARGET_LINK = "Link_Left_Wrist_Lower_to_Gripper"
RIGHT_TARGET_LINK = "Link_Right_Wrist_Lower_to_Gripper"

NECK_LOCK_JOINTS = [
    "Joint_Neck_Roll",
    "Joint_Neck_Pitch",
    "Joint_Neck_Yaw",
]

DUAL_LOCK_JOINTS = [
    "Joint_Ankle",
    "Joint_Knee",
    "Joint_Waist_Pitch",
    "Joint_Waist_Yaw",
]

DUAL_ACTIVE_JOINTS = [
    "Joint_Left_Shoulder_Inner",
    "Joint_Left_Shoulder_Outer",
    "Joint_Left_UpperArm",
    "Joint_Left_Elbow",
    "Joint_Left_Forearm",
    "Joint_Left_Wrist_Upper",
    "Joint_Left_Wrist_Lower",
    "Joint_Right_Shoulder_Inner",
    "Joint_Right_Shoulder_Outer",
    "Joint_Right_UpperArm",
    "Joint_Right_Elbow",
    "Joint_Right_Forearm",
    "Joint_Right_Wrist_Upper",
    "Joint_Right_Wrist_Lower",
]

ARM_MODEL_JOINTS = [*DUAL_LOCK_JOINTS, *DUAL_ACTIVE_JOINTS]


def _load_dual_ik_solver():
    spec = importlib.util.spec_from_file_location("robot_action_editor_ik_solver", ARM_IK_SOLVER_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load IK solver module from {ARM_IK_SOLVER_PATH}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.pin_ik_solver_dual_lmc


def _as_float_array(values: list[float], size: int, field_name: str) -> np.ndarray:
    if len(values) != size:
        raise ValueError(f"{field_name} must contain {size} values")
    return np.array([float(value) for value in values], dtype=np.float64)


def _as_joint_positions(payload: dict, field_name: str) -> dict[str, float]:
    if not isinstance(payload, dict):
        raise ValueError(f"{field_name} must be an object")

    positions: dict[str, float] = {}
    for joint_name, value in payload.items():
        positions[str(joint_name)] = float(value)
    return positions


@dataclass(frozen=True)
class TargetPose:
    position: np.ndarray
    quaternion: np.ndarray

    @classmethod
    def from_payload(cls, payload: dict, field_name: str) -> "TargetPose":
        if not isinstance(payload, dict):
            raise ValueError(f"{field_name} must be an object")

        position = _as_float_array(list(payload.get("position") or []), 3, f"{field_name}.position")
        quaternion = _as_float_array(list(payload.get("quaternion") or []), 4, f"{field_name}.quaternion")

        norm = np.linalg.norm(quaternion)
        if norm <= 1e-8:
            raise ValueError(f"{field_name}.quaternion must not be zero")

        quaternion = quaternion / norm
        return cls(position=position, quaternion=quaternion)

    def to_pose_xyzquat(self) -> np.ndarray:
        return np.concatenate([self.position, self.quaternion])


class DualArmIkService:
    def __init__(self) -> None:
        self._solver = _load_dual_ik_solver()
        self._lock = Lock()
        self._full_model = pin.buildModelFromUrdf(str(ROBOT_URDF_PATH))

        neck_lock_ids = [self._full_model.getJointId(name) for name in NECK_LOCK_JOINTS]
        self._arm_model = pin.buildReducedModel(self._full_model, neck_lock_ids, np.zeros(self._full_model.nq))
        self._dual_lock_ids = [self._arm_model.getJointId(name) for name in DUAL_LOCK_JOINTS]

        self._require_joint_names(self._arm_model, ARM_MODEL_JOINTS)
        self._require_frame_names(self._arm_model, [LEFT_TARGET_LINK, RIGHT_TARGET_LINK])

    def solve(self, payload: dict) -> dict:
        if not isinstance(payload, dict):
            raise ValueError("Payload must be an object")

        joint_positions = payload.get("jointPositions")
        targets = payload.get("targets")

        if not isinstance(joint_positions, dict):
            raise ValueError("jointPositions must be an object")
        if not isinstance(targets, dict):
            raise ValueError("targets must be an object")

        left_target = TargetPose.from_payload(targets.get("left") or {}, "targets.left")
        right_target = TargetPose.from_payload(targets.get("right") or {}, "targets.right")

        with self._lock:
            return self._solve_locked(joint_positions, left_target, right_target)

    def interpolate_keyframes(self, payload: dict) -> dict:
        if not isinstance(payload, dict):
            raise ValueError("Payload must be an object")

        left_joint_positions = _as_joint_positions(payload.get("leftJointPositions") or {}, "leftJointPositions")
        right_joint_positions = _as_joint_positions(payload.get("rightJointPositions") or {}, "rightJointPositions")
        sample_hz = min(200, max(4, int(payload.get("sampleHz") or 30)))
        duration = max(0.001, float(payload.get("duration") or 1.0))

        with self._lock:
            return self._interpolate_keyframes_locked(left_joint_positions, right_joint_positions, sample_hz, duration)

    def _solve_locked(self, joint_positions: dict, left_target: TargetPose, right_target: TargetPose) -> dict:
        arm_model_q = self._build_configuration(self._arm_model, ARM_MODEL_JOINTS, joint_positions)
        reduced_model = pin.buildReducedModel(self._arm_model, self._dual_lock_ids, arm_model_q)
        reduced_data = reduced_model.createData()

        self._require_joint_names(reduced_model, DUAL_ACTIVE_JOINTS)
        self._require_frame_names(reduced_model, [LEFT_TARGET_LINK, RIGHT_TARGET_LINK])

        q0 = self._build_configuration(reduced_model, DUAL_ACTIVE_JOINTS, joint_positions)
        q_lower = reduced_model.lowerPositionLimit.copy()
        q_upper = reduced_model.upperPositionLimit.copy()

        left_frame_id = reduced_model.getFrameId(LEFT_TARGET_LINK)
        right_frame_id = reduced_model.getFrameId(RIGHT_TARGET_LINK)

        success, solved_q, iterations = self._solver(
            left_target.to_pose_xyzquat(),
            right_target.to_pose_xyzquat(),
            q0,
            q_lower,
            q_upper,
            left_frame_id,
            right_frame_id,
            reduced_model,
            reduced_data,
            shared_joints=0,
            share_joints_gradients_ratio=1.0,
            enable_joint_clip=True,
            eps=1e-5,
            step_factor=1.5,
            max_iteration=200,
            max_duration=1.0 / 20.0,
            we=[10.0, 10.0, 10.0, 1.0, 1.0, 1.0],
            lambda_=1.0,
            return_iter=True,
        )

        if solved_q is None:
            solved_q = q0.copy()

        solved_q = np.array(solved_q, dtype=np.float64)

        pin.forwardKinematics(reduced_model, reduced_data, solved_q)
        pin.updateFramePlacement(reduced_model, reduced_data, left_frame_id)
        pin.updateFramePlacement(reduced_model, reduced_data, right_frame_id)

        return {
            "success": bool(success),
            "iterations": int(iterations),
            "jointPositions": self._extract_joint_positions(reduced_model, DUAL_ACTIVE_JOINTS, solved_q),
            "achievedTargets": {
                "left": self._frame_pose_payload(reduced_data.oMf[left_frame_id]),
                "right": self._frame_pose_payload(reduced_data.oMf[right_frame_id]),
            },
        }

    def _interpolate_keyframes_locked(
        self,
        left_joint_positions: dict[str, float],
        right_joint_positions: dict[str, float],
        sample_hz: int,
        duration: float,
    ) -> dict:
        left_targets = self._forward_targets(left_joint_positions)
        right_targets = self._forward_targets(right_joint_positions)
        total_samples = max(2, int(round(duration * sample_hz)) + 1)
        solved_joint_positions = dict(left_joint_positions)
        frames: list[dict] = [
            {
                "time": 0.0,
                "jointPositions": dict(left_joint_positions),
            }
        ]
        success_count = 0

        for index in range(1, total_samples - 1):
            progress = index / (total_samples - 1)
            interpolated_left = self._interpolate_target_pose(left_targets["left"], right_targets["left"], progress)
            interpolated_right = self._interpolate_target_pose(left_targets["right"], right_targets["right"], progress)
            solve_result = self._solve_locked(solved_joint_positions, interpolated_left, interpolated_right)
            solved_joint_positions = {**solved_joint_positions, **solve_result["jointPositions"]}
            success_count += int(bool(solve_result["success"]))
            frames.append(
                {
                    "time": float(duration * progress),
                    "jointPositions": dict(solved_joint_positions),
                }
            )

        frames.append(
            {
                "time": float(duration),
                "jointPositions": dict(right_joint_positions),
            }
        )

        return {
            "ok": True,
            "sampleHz": sample_hz,
            "duration": duration,
            "frames": frames,
            "successCount": success_count,
            "totalFrames": len(frames),
        }

    def _forward_targets(self, joint_positions: dict[str, float]) -> dict[str, TargetPose]:
        arm_model_q = self._build_configuration(self._arm_model, ARM_MODEL_JOINTS, joint_positions)
        reduced_model = pin.buildReducedModel(self._arm_model, self._dual_lock_ids, arm_model_q)
        reduced_data = reduced_model.createData()

        q = self._build_configuration(reduced_model, DUAL_ACTIVE_JOINTS, joint_positions)
        pin.forwardKinematics(reduced_model, reduced_data, q)

        left_frame_id = reduced_model.getFrameId(LEFT_TARGET_LINK)
        right_frame_id = reduced_model.getFrameId(RIGHT_TARGET_LINK)
        pin.updateFramePlacement(reduced_model, reduced_data, left_frame_id)
        pin.updateFramePlacement(reduced_model, reduced_data, right_frame_id)

        return {
            "left": self._target_pose_from_placement(reduced_data.oMf[left_frame_id]),
            "right": self._target_pose_from_placement(reduced_data.oMf[right_frame_id]),
        }

    def _target_pose_from_placement(self, placement: pin.SE3) -> TargetPose:
        quaternion = pin.Quaternion(placement.rotation)
        return TargetPose(
            position=placement.translation.astype(np.float64),
            quaternion=np.array(
                [
                    float(quaternion.x),
                    float(quaternion.y),
                    float(quaternion.z),
                    float(quaternion.w),
                ],
                dtype=np.float64,
            ),
        )

    def _interpolate_target_pose(self, start_pose: TargetPose, end_pose: TargetPose, progress: float) -> TargetPose:
        clamped = min(max(progress, 0.0), 1.0)
        return TargetPose(
            position=(1.0 - clamped) * start_pose.position + clamped * end_pose.position,
            quaternion=self._slerp_quaternion(start_pose.quaternion, end_pose.quaternion, clamped),
        )

    def _slerp_quaternion(self, start_quaternion: np.ndarray, end_quaternion: np.ndarray, progress: float) -> np.ndarray:
        start = start_quaternion / max(np.linalg.norm(start_quaternion), 1e-8)
        end = end_quaternion / max(np.linalg.norm(end_quaternion), 1e-8)
        dot = float(np.dot(start, end))

        if dot < 0.0:
            end = -end
            dot = -dot

        if dot > 0.9995:
            blended = start + progress * (end - start)
            return blended / max(np.linalg.norm(blended), 1e-8)

        theta_0 = float(np.arccos(np.clip(dot, -1.0, 1.0)))
        sin_theta_0 = float(np.sin(theta_0))
        theta = theta_0 * progress
        sin_theta = float(np.sin(theta))
        scale_start = float(np.sin(theta_0 - theta) / sin_theta_0)
        scale_end = float(sin_theta / sin_theta_0)
        return scale_start * start + scale_end * end

    def _build_configuration(self, model: pin.Model, joint_names: list[str], joint_positions: dict) -> np.ndarray:
        q = np.zeros(model.nq, dtype=np.float64)
        for joint_name in joint_names:
            joint_id = model.getJointId(joint_name)
            joint = model.joints[joint_id]
            if joint.nq != 1:
                raise ValueError(f"Only single-DoF joints are supported, got {joint_name} with nq={joint.nq}")
            q[joint.idx_q] = float(joint_positions.get(joint_name, 0.0))
        return q

    def _extract_joint_positions(self, model: pin.Model, joint_names: list[str], q: np.ndarray) -> dict[str, float]:
        positions: dict[str, float] = {}
        for joint_name in joint_names:
            joint_id = model.getJointId(joint_name)
            joint = model.joints[joint_id]
            positions[joint_name] = float(q[joint.idx_q])
        return positions

    def _frame_pose_payload(self, placement: pin.SE3) -> dict[str, list[float]]:
        quaternion = pin.Quaternion(placement.rotation)
        return {
            "position": placement.translation.astype(float).tolist(),
            "quaternion": [
                float(quaternion.x),
                float(quaternion.y),
                float(quaternion.z),
                float(quaternion.w),
            ],
        }

    @staticmethod
    def _require_joint_names(model: pin.Model, joint_names: list[str]) -> None:
        missing = [name for name in joint_names if not model.existJointName(name)]
        if missing:
            raise ValueError(f"Required joints not found in Pinocchio model: {', '.join(missing)}")

    @staticmethod
    def _require_frame_names(model: pin.Model, frame_names: list[str]) -> None:
        missing = [name for name in frame_names if not model.existFrame(name)]
        if missing:
            raise ValueError(f"Required frames not found in Pinocchio model: {', '.join(missing)}")
