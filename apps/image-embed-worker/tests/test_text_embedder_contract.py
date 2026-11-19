from types import SimpleNamespace

import numpy as np
import pytest
import torch
import transformers

import config
import image_embed_poller as poller


@pytest.mark.parametrize("empty", ["", " \n ", None])
def test_blank_does_not_load(monkeypatch, empty):
    worker = poller.Poller(SimpleNamespace(download_threads=1), None)
    errors = []
    monkeypatch.setattr(worker.text_embedder, "load", lambda: pytest.fail("blank loads model"))
    monkeypatch.setattr(worker, "text_mark_error", lambda *args: errors.append(args[1:]))
    worker.process_text_batch([row(empty)])
    assert errors == [("empty embedding input", "permanent")]
    assert worker.text_failed == 1
    assert not worker.text_embedder.loaded


def row(text):
    return ("style_group", None, text, None, config.TEXT_MODEL_STAMP, None, None, 1)


@pytest.mark.parametrize("device,dtype", [("cpu", torch.float32), ("cuda", torch.float16)])
def test_lazy_idle_stamp_dtype_and_padded_document_arrays(monkeypatch, capsys, device, dtype):
    calls = []
    expected_stamp = "Qwen/Qwen3-Embedding-0.6B@97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3"

    class Batch(dict):
        def to(self, target):
            assert target == device
            return self

    class Tokenizer:
        def __call__(self, texts, **kwargs):
            assert texts == ["red frame", "blue"]
            assert kwargs == dict(padding=True, truncation=True, max_length=config.TEXT_MAX_TOKENS, return_tensors="pt")
            ids = torch.tensor([[1, 2], [0, 3]])
            return Batch(input_ids=ids, attention_mask=ids.ne(0))

    class Model:
        def to(self, target):
            assert target == device
            return self

        def eval(self):
            return self

        def __call__(self, input_ids, attention_mask):
            assert input_ids.tolist() == [[1, 2], [0, 3]]
            assert attention_mask.tolist() == [[True, True], [False, True]]
            hidden = torch.zeros((2, 2, config.TEXT_DIM), dtype=dtype)
            hidden[0, 0, 2], hidden[0, 1, :2] = 8, torch.tensor([3, 4])
            hidden[1, 0, 2], hidden[1, 1, 1] = 9, 7
            return SimpleNamespace(last_hidden_state=hidden)

    def load_tokenizer(source, **kwargs):
        calls.append(("tokenizer", source, kwargs))
        return Tokenizer()

    def load_model(source, **kwargs):
        calls.append(("model", source, kwargs))
        return Model()

    monkeypatch.setattr(torch.cuda, "is_available", lambda: device == "cuda")
    monkeypatch.setattr(torch.cuda, "empty_cache", lambda: calls.append(("empty_cache",)))
    monkeypatch.setattr(transformers.AutoTokenizer, "from_pretrained", staticmethod(load_tokenizer))
    monkeypatch.setattr(transformers.AutoModel, "from_pretrained", staticmethod(load_model))
    worker = poller.Poller(SimpleNamespace(download_threads=1), None)
    monkeypatch.setattr(worker, "serve_query_lane_between_saves", lambda: None)
    saved = []
    monkeypatch.setattr(worker, "text_upsert", lambda row_, vector: saved.append((row_[4], vector.copy())) or True)
    embedder = worker.text_embedder
    assert not embedder.loaded and calls == []
    for _ in range(2):
        worker.process_text_batch([row(" red frame "), row("blue")])
    load_calls = [
        ("tokenizer", config.TEXT_MODEL_ID, dict(padding_side="left", revision=config.TEXT_MODEL_REVISION)),
        ("model", config.TEXT_MODEL_ID, dict(torch_dtype=dtype, revision=config.TEXT_MODEL_REVISION)),
    ]
    assert calls == load_calls
    old_model = embedder.model
    embedder.last_used = poller.time.time() - config.TEXT_IDLE_UNLOAD_S - 1
    monkeypatch.setattr(worker, "claim_text_docs", lambda: [])
    assert worker.poll_text_lane() == "empty"
    assert embedder.model is None and embedder.tokenizer is None
    worker.process_text_batch([row("red frame"), row("blue")])
    assert embedder.model is not old_model
    assert calls == load_calls + ([("empty_cache",)] if device == "cuda" else []) + load_calls
    assert len(saved) == 6
    expected = np.zeros((2, config.TEXT_DIM), dtype=np.float32)
    expected[0, :2], expected[1, 1] = [0.6, 0.8], 1.0
    for offset in range(0, 6, 2):
        assert [stamp for stamp, _ in saved[offset:offset+2]] == [expected_stamp] * 2
        vectors = np.stack([vector for _, vector in saved[offset:offset+2]])
        assert vectors.dtype == np.float32
        np.testing.assert_array_equal(vectors, expected)
    logs = capsys.readouterr().out
    assert logs.count(expected_stamp) == 2 and logs.count("text_model_unloaded") == 1
