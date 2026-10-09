import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import transcribe


class TranscriptionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.audio = Path(self.directory.name) / "sample.m4a"
        self.audio.write_bytes(b"test audio")
        auth = json.dumps({"tokens": {"access_token": "fake-test-token", "account_id": "fake-test-account"}})
        self.auth = patch.object(Path, "read_text", return_value=auth).start()
        self.addCleanup(patch.stopall)
        self.mime = Mock()
        patch.object(transcribe, "CurlMime", return_value=self.mime).start()

    def test_audio_metadata_and_transport_are_correct(self):
        response = Mock(status_code=200)
        response.json.return_value = {"text": "Expected transcript"}
        with patch.object(transcribe.requests, "post", return_value=response) as post:
            self.assertEqual(transcribe.transcribe(self.audio), "Expected transcript")
        self.mime.addpart.assert_called_once_with(name="file", content_type="audio/mp4",
                                                  filename="dictation.m4a", data=b"test audio")
        self.assertEqual(post.call_args.args, (transcribe.ENDPOINT,))
        self.assertFalse(post.call_args.kwargs["allow_redirects"])
        self.mime.close.assert_called_once()

    def test_wav_remains_an_active_supported_input(self):
        self.audio = self.audio.rename(self.audio.with_suffix(".wav"))
        response = Mock(status_code=200)
        response.json.return_value = {"text": "WAV transcript"}
        with patch.object(transcribe.requests, "post", return_value=response):
            self.assertEqual(transcribe.transcribe(self.audio), "WAV transcript")
        self.assertEqual(self.mime.addpart.call_args.kwargs["content_type"], "audio/wav")

    def test_empty_and_oversized_files_never_send_requests(self):
        with patch.object(transcribe.requests, "post") as post:
            self.audio.write_bytes(b"")
            with self.assertRaisesRegex(RuntimeError, "nonempty"):
                transcribe.transcribe(self.audio)
            with patch.object(Path, "read_bytes", return_value=bytes(25 * 1024 * 1024 + 1)):
                with self.assertRaisesRegex(RuntimeError, "25 MB"):
                    transcribe.transcribe(self.audio)
            post.assert_not_called()

    def test_missing_login_never_sends_audio(self):
        self.auth.return_value = "{}"
        with patch.object(transcribe.requests, "post") as post:
            with self.assertRaisesRegex(RuntimeError, "login missing"):
                transcribe.transcribe(self.audio)
            post.assert_not_called()

    def test_timeout_closes_multipart_and_reports_recovery(self):
        with patch.object(transcribe.requests, "post", side_effect=transcribe.requests.RequestsError("test timeout")):
            with self.assertRaisesRegex(RuntimeError, "connection failed or timed out"):
                transcribe.transcribe(self.audio)
        self.mime.close.assert_called_once()

    def test_auth_failure_and_invalid_response_are_clear(self):
        response = Mock(status_code=401)
        with patch.object(transcribe.requests, "post", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "login again"):
                transcribe.transcribe(self.audio)
            response.status_code = 200
            response.json.return_value = {"text": None}
            with self.assertRaisesRegex(RuntimeError, "unexpected transcription"):
                transcribe.transcribe(self.audio)


if __name__ == "__main__":
    unittest.main()
