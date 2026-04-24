from __future__ import annotations

import argparse
import base64
from datetime import datetime
import json
import mimetypes
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

from autolife_robot_sdk import ROBOT_URDF_PATH

PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = PROJECT_ROOT / "static"
SDK_URDF_PATH = Path(ROBOT_URDF_PATH).resolve()
SAVED_ACTIONS_ROOT = PROJECT_ROOT / "saved_actions"
SAVED_PROJECTS_ROOT = PROJECT_ROOT / "saved_projects"
PROJECT_FILE_EXTENSION = ".alproj"
LEGACY_PROJECT_FILE_EXTENSION = ".json"
PROJECT_FILE_MAGIC = "AUTOLIFE_ROBOT_PROJECT_V1"


def resolve_descriptions_root(urdf_path: Path) -> Path:
    for candidate in (urdf_path.parent, *urdf_path.parents):
        if candidate.name == "descriptions":
            return candidate

    raise ValueError(f"Unable to locate descriptions root from ROBOT_URDF_PATH: {urdf_path}")


DESCRIPTIONS_ROOT = resolve_descriptions_root(SDK_URDF_PATH)


@dataclass(frozen=True)
class AppConfig:
    host: str
    port: int


def build_manifest() -> dict:
    urdf_path = resolve_sdk_urdf_path()
    relative_urdf_path = urdf_path.relative_to(DESCRIPTIONS_ROOT)
    model_name = relative_urdf_path.parts[0]
    file_name = relative_urdf_path.name
    joint_order = extract_joint_order(urdf_path)

    default_selection = {
        "model": model_name,
        "file": file_name,
    }

    return {
        "generatedAt": None,
        "defaultSelection": default_selection,
        "urdfPath": str(urdf_path),
        "jointOrder": joint_order,
        "robots": [
            {
                "model": model_name,
                "files": [
                    {
                        "file": file_name,
                        "label": file_name.removesuffix(".urdf"),
                        "url": f"/robots/{relative_urdf_path.as_posix()}",
                    }
                ],
            }
        ],
    }


def resolve_sdk_urdf_path() -> Path:
    sdk_urdf_path = SDK_URDF_PATH

    if not sdk_urdf_path.exists():
        raise FileNotFoundError(f"SDK ROBOT_URDF_PATH not found: {sdk_urdf_path}")

    try:
        sdk_urdf_path.relative_to(DESCRIPTIONS_ROOT.resolve())
    except ValueError as error:
        raise ValueError(f"SDK ROBOT_URDF_PATH is outside descriptions root: {sdk_urdf_path}") from error

    return sdk_urdf_path


def extract_joint_order(urdf_path: Path) -> list[str]:
    root = ET.fromstring(urdf_path.read_text(encoding="utf-8"))
    joint_names: list[str] = []

    for joint_node in root.findall("joint"):
        joint_name = joint_node.attrib.get("name")
        if joint_name:
            joint_names.append(joint_name)

    return joint_names


def safe_join(root: Path, relative_path: str) -> Path | None:
    candidate = (root / relative_path).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def list_saved_actions() -> list[dict]:
    if not SAVED_ACTIONS_ROOT.exists():
        return []

    actions: list[dict] = []

    for action_path in sorted(
        SAVED_ACTIONS_ROOT.glob("*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    ):
        try:
            payload = json.loads(action_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        if not isinstance(payload, dict):
            continue

        actions.append(
            {
                "fileName": action_path.name,
                "title": action_path.stem,
                "path": str(action_path),
                "payload": {
                    "left_arm": payload.get("left_arm", []),
                    "right_arm": payload.get("right_arm", []),
                    "waist_leg": payload.get("waist_leg", []),
                    "duration": payload.get("duration", 2.0),
                },
            }
        )

    return actions


def default_project_payload() -> dict:
    return {
        "title": "untitled_project",
        "duration": 12.0,
        "controlHz": 100,
        "topics": {
            "motion": "/robot/motion_plan",
            "voice": "/robot/tts_plan",
        },
        "jointNames": [],
        "actionKeyframes": [],
        "voiceClips": [],
    }


def encode_project_payload(payload: dict) -> str:
    json_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(json_bytes).decode("ascii")
    return f"{PROJECT_FILE_MAGIC}\n{encoded}\n"


def decode_project_payload(raw_text: str, file_path: Path) -> dict:
    if file_path.suffix == LEGACY_PROJECT_FILE_EXTENSION:
        payload = json.loads(raw_text)
    else:
        lines = raw_text.splitlines()
        if not lines or lines[0].strip() != PROJECT_FILE_MAGIC:
            raise ValueError(f"Unsupported project file format: {file_path.name}")
        encoded = "".join(line.strip() for line in lines[1:] if line.strip())
        if not encoded:
            raise ValueError(f"Project file payload is empty: {file_path.name}")
        payload = json.loads(base64.urlsafe_b64decode(encoded.encode("ascii")).decode("utf-8"))

    if not isinstance(payload, dict):
        raise ValueError(f"Project file payload must be an object: {file_path.name}")

    return payload


def iter_saved_project_paths() -> list[Path]:
    if not SAVED_PROJECTS_ROOT.exists():
        return []

    paths = [
        *SAVED_PROJECTS_ROOT.glob(f"*{PROJECT_FILE_EXTENSION}"),
        *SAVED_PROJECTS_ROOT.glob(f"*{LEGACY_PROJECT_FILE_EXTENSION}"),
    ]
    return sorted(paths, key=lambda path: path.stat().st_mtime, reverse=True)


def list_saved_projects() -> list[dict]:
    if not SAVED_PROJECTS_ROOT.exists():
        return []

    projects: list[dict] = []

    for project_path in iter_saved_project_paths():
        try:
            payload = decode_project_payload(project_path.read_text(encoding="utf-8"), project_path)
        except (OSError, json.JSONDecodeError, ValueError, base64.binascii.Error):
            continue

        merged_payload = default_project_payload()
        merged_payload.update(payload)
        merged_payload["topics"] = {
            **default_project_payload()["topics"],
            **(payload.get("topics") if isinstance(payload.get("topics"), dict) else {}),
        }

        projects.append(
            {
                "fileName": project_path.name,
                "title": str(merged_payload.get("title") or project_path.stem),
                "path": str(project_path),
                "payload": merged_payload,
            }
        )

    return projects


def normalize_project_payload(payload: dict) -> dict:
    normalized = default_project_payload()
    normalized.update(payload)

    topics = payload.get("topics") if isinstance(payload.get("topics"), dict) else {}
    normalized["topics"] = {
        **default_project_payload()["topics"],
        **topics,
    }

    normalized["title"] = str(normalized.get("title") or "untitled_project").strip() or "untitled_project"
    normalized["duration"] = max(1.0, float(normalized.get("duration", 12.0)))
    normalized["controlHz"] = max(1, int(normalized.get("controlHz", 100)))
    normalized["jointNames"] = list(normalized.get("jointNames") or [])
    normalized["actionKeyframes"] = list(normalized.get("actionKeyframes") or [])
    normalized["voiceClips"] = list(normalized.get("voiceClips") or [])

    return normalized


class RobotViewerHandler(BaseHTTPRequestHandler):
    manifest = build_manifest()
    ik_service = None

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        request_path = parsed.path

        if request_path in {"/", "/index.html"}:
            self.serve_file(STATIC_ROOT / "index.html", content_type="text/html; charset=utf-8")
            return

        if request_path == "/api/manifest":
            self.serve_json(self.manifest)
            return

        if request_path == "/api/saved-actions":
            self.serve_json({"actions": list_saved_actions()})
            return

        if request_path == "/api/projects":
            self.serve_json({"projects": list_saved_projects()})
            return

        if request_path.startswith("/static/"):
            relative_path = request_path.removeprefix("/static/")
            file_path = safe_join(STATIC_ROOT, relative_path)
            if file_path is None:
                self.send_error(HTTPStatus.FORBIDDEN)
                return
            self.serve_file(file_path)
            return

        if request_path.startswith("/robots/"):
            relative_path = request_path.removeprefix("/robots/")
            file_path = safe_join(DESCRIPTIONS_ROOT, relative_path)
            if file_path is None:
                self.send_error(HTTPStatus.FORBIDDEN)
                return
            self.serve_file(file_path)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        request_path = parsed.path

        if request_path == "/api/save-pose":
            self.handle_save_pose()
            return

        if request_path == "/api/save-project":
            self.handle_save_project()
            return

        if request_path == "/api/ik/solve":
            self.handle_ik_solve()
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args) -> None:
        return

    def serve_json(self, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_json_error(self, status: HTTPStatus, message: str, *, detail: str | None = None) -> None:
        payload = {
            "ok": False,
            "error": status.phrase,
            "message": message,
        }
        if detail:
            payload["detail"] = detail

        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, file_path: Path, content_type: str | None = None) -> None:
        if not file_path.exists() or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        body = file_path.read_bytes()
        guessed_type, _ = mimetypes.guess_type(str(file_path))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or guessed_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def handle_save_pose(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON body")
            return

        if not isinstance(payload, dict):
            self.send_error(HTTPStatus.BAD_REQUEST, "Payload must be an object")
            return

        SAVED_ACTIONS_ROOT.mkdir(parents=True, exist_ok=True)

        title = str(payload.get("title") or "").strip()
        if not title:
            self.send_error(HTTPStatus.BAD_REQUEST, "Title is required")
            return

        safe_title = sanitize_file_name(title)
        target_path = next_available_action_path(safe_title)

        save_payload = {
            "left_arm": payload.get("left_arm", []),
            "right_arm": payload.get("right_arm", []),
            "waist_leg": payload.get("waist_leg", []),
            "duration": float(payload.get("duration", 2.0)),
        }

        target_path.write_text(format_json_payload(save_payload), encoding="utf-8")

        self.serve_json(
            {
                "ok": True,
                "path": str(target_path),
                "fileName": target_path.name,
                "title": title,
            }
        )

    def handle_save_project(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON body")
            return

        if not isinstance(payload, dict):
            self.send_error(HTTPStatus.BAD_REQUEST, "Payload must be an object")
            return

        SAVED_PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)

        normalized_payload = normalize_project_payload(payload)
        safe_title = sanitize_file_name(normalized_payload["title"])
        requested_file_name = str(payload.get("fileName") or "").strip() or None
        target_path = resolve_project_save_path(requested_file_name, safe_title)
        target_path.write_text(encode_project_payload(normalized_payload), encoding="utf-8")

        self.serve_json(
            {
                "ok": True,
                "path": str(target_path),
                "fileName": target_path.name,
                "title": normalized_payload["title"],
            }
        )

    def handle_ik_solve(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.serve_json_error(HTTPStatus.BAD_REQUEST, "Invalid JSON body")
            return

        if not isinstance(payload, dict):
            self.serve_json_error(HTTPStatus.BAD_REQUEST, "Payload must be an object")
            return

        try:
            if self.__class__.ik_service is None:
                from ik_backend import DualArmIkService

                self.__class__.ik_service = DualArmIkService()

            result = self.__class__.ik_service.solve(payload)
        except ValueError as error:
            self.serve_json_error(HTTPStatus.BAD_REQUEST, str(error), detail=str(error))
            return
        except Exception as error:
            self.serve_json_error(HTTPStatus.INTERNAL_SERVER_ERROR, "IK solve failed", detail=str(error))
            return

        self.serve_json(result)


def sanitize_file_name(name: str) -> str:
    safe = "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in name.strip())
    safe = safe.strip("_")
    return safe or "robot_action"


def next_available_action_path(base_name: str) -> Path:
    candidate = SAVED_ACTIONS_ROOT / f"{base_name}.json"
    if not candidate.exists():
        return candidate

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return SAVED_ACTIONS_ROOT / f"{base_name}_{timestamp}.json"


def next_available_project_path(base_name: str) -> Path:
    candidate = SAVED_PROJECTS_ROOT / f"{base_name}{PROJECT_FILE_EXTENSION}"
    if not candidate.exists():
        return candidate

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return SAVED_PROJECTS_ROOT / f"{base_name}_{timestamp}{PROJECT_FILE_EXTENSION}"


def resolve_project_save_path(file_name: str | None, base_name: str) -> Path:
    if file_name:
        requested_path = safe_join(SAVED_PROJECTS_ROOT, file_name)
        if requested_path and requested_path.suffix == PROJECT_FILE_EXTENSION:
            return requested_path

    return next_available_project_path(base_name)


def format_json_payload(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def parse_args() -> AppConfig:
    parser = argparse.ArgumentParser(description="Python URDF web viewer")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    return AppConfig(host=args.host, port=args.port)


def main() -> None:
    if not DESCRIPTIONS_ROOT.exists():
        raise FileNotFoundError(f"Descriptions directory not found: {DESCRIPTIONS_ROOT}")

    config = parse_args()
    server = ThreadingHTTPServer((config.host, config.port), RobotViewerHandler)
    print(f"Robot viewer running at http://{config.host}:{config.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()