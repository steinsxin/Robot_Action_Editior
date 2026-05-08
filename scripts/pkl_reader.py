from __future__ import annotations

import argparse
import pickle
from pathlib import Path
from pprint import pprint


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Read an exported robot motion pickle file")
	parser.add_argument("pkl_path", type=Path, help="Path to the exported .pkl file")
	parser.add_argument("--limit", type=int, default=5, help="How many leading frames to print")
	return parser.parse_args()


def load_pickle(path: Path) -> dict:
	if not path.exists():
		raise FileNotFoundError(f"Pickle file not found: {path}")

	with path.open("rb") as input_file:
		payload = pickle.load(input_file)

	if not isinstance(payload, dict):
		raise ValueError("Expected pickle payload to be a dict")

	return payload


def normalize_command(command: dict) -> dict:
	if not isinstance(command, dict):
		raise ValueError("Each command must be a dict")

	def positions_for(field_name: str) -> list[float]:
		joint_state = command.get(field_name)
		if not isinstance(joint_state, dict):
			return []
		positions = joint_state.get("position")
		if not isinstance(positions, list):
			return []
		return [float(value) for value in positions]

	return {
		"time": float(command.get("time") or 0.0),
		"left_arm_joint_state": {
			"position": positions_for("left_arm_joint_state"),
		},
		"right_arm_joint_state": {
			"position": positions_for("right_arm_joint_state"),
		},
		"waist_joint_state": {
			"position": positions_for("waist_joint_state"),
		},
	}


def build_preview(payload: dict, limit: int) -> dict:
	commands = payload.get("commands")
	if not isinstance(commands, list):
		raise ValueError("Expected payload['commands'] to be a list")

	preview_count = max(0, min(int(limit), len(commands)))
	preview_commands = [normalize_command(command) for command in commands[:preview_count]]

	return {
		"meta": payload.get("meta", {}),
		"jointPositionUnit": payload.get("meta", {}).get("jointPositionUnit", "unknown"),
		"motionPlan": payload.get("motionPlan", {}),
		"commandCount": len(commands),
		"preview": preview_commands,
	}


def main() -> None:
	args = parse_args()
	payload = load_pickle(args.pkl_path)
	preview = build_preview(payload, args.limit)
	pprint(preview, sort_dicts=False)


if __name__ == "__main__":
	main()
