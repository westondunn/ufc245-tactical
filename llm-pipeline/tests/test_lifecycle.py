from types import SimpleNamespace

import pytest

import app
import cli
import scheduler
from pipeline.orchestrator import Orchestrator


class _ClosableProvider:
    def __init__(self):
        self.close_calls = 0

    def close(self):
        self.close_calls += 1


def _orchestrator(provider, *, owns_provider=None):
    cfg = SimpleNamespace(
        main_app_url="http://main.test",
        prediction_service_key="key",
        scrapers_enabled=frozenset(),
    )
    kwargs = {}
    if owns_provider is not None:
        kwargs["owns_provider"] = owns_provider
    return Orchestrator(
        cfg=cfg,
        store=object(),
        provider=provider,
        runner=object(),
        **kwargs,
    )


def test_orchestrator_closes_owned_provider_once():
    provider = _ClosableProvider()
    orchestrator = _orchestrator(provider, owns_provider=True)
    with orchestrator:
        pass
    orchestrator.close()
    assert provider.close_calls == 1


def test_orchestrator_leaves_injected_provider_open_by_default():
    provider = _ClosableProvider()
    orchestrator = _orchestrator(provider)
    with orchestrator:
        pass
    assert provider.close_calls == 0


def test_orchestrator_closes_on_exception():
    provider = _ClosableProvider()
    with pytest.raises(RuntimeError, match="boom"):
        with _orchestrator(provider, owns_provider=True):
            raise RuntimeError("boom")
    assert provider.close_calls == 1


class _FakeRunContext:
    def __init__(self, *, error=None):
        self.error = error
        self.entered = 0
        self.exited = 0
        self.run_calls = []

    def __enter__(self):
        self.entered += 1
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.exited += 1
        return False

    def run(self, **kwargs):
        self.run_calls.append(kwargs)
        if self.error:
            raise self.error
        return {"status": "ok"}


@pytest.mark.parametrize("error", [None, RuntimeError("cli failure")])
def test_cli_enrichment_uses_context_manager(monkeypatch, error):
    context = _FakeRunContext(error=error)
    monkeypatch.setattr(cli, "_store", lambda: object())
    monkeypatch.setattr(cli.Orchestrator, "from_env", lambda **_kwargs: context)
    args = SimpleNamespace(dry_run=True, event=7)
    if error:
        with pytest.raises(RuntimeError, match="cli failure"):
            cli.cmd_enrich(args)
    else:
        assert cli.cmd_enrich(args) == 0
    assert context.entered == 1
    assert context.exited == 1


@pytest.mark.parametrize("error", [None, RuntimeError("scheduler failure")])
def test_scheduler_enrichment_uses_context_manager(monkeypatch, error):
    context = _FakeRunContext(error=error)
    monkeypatch.setattr(
        scheduler.Config,
        "from_env",
        lambda: SimpleNamespace(scheduler_cron_hour=8),
    )
    monkeypatch.setattr(scheduler.Orchestrator, "from_env", lambda **_kwargs: context)
    sched = scheduler.build_scheduler(object())
    job = sched.get_job("daily_enrich")
    if error:
        with pytest.raises(RuntimeError, match="scheduler failure"):
            job.func()
    else:
        job.func()
    assert context.entered == 1
    assert context.exited == 1


@pytest.mark.parametrize("error", [None, RuntimeError("api failure")])
def test_api_trigger_uses_context_manager(monkeypatch, error):
    context = _FakeRunContext(error=error)
    monkeypatch.setattr(app, "_cfg", SimpleNamespace(prediction_service_key="key"))
    monkeypatch.setattr(app, "_store", object())
    monkeypatch.setattr(app.Orchestrator, "from_env", lambda **_kwargs: context)
    if error:
        with pytest.raises(RuntimeError, match="api failure"):
            app.trigger_enrich(x_prediction_key="key", dry_run=True, event_id=9)
    else:
        assert app.trigger_enrich(
            x_prediction_key="key", dry_run=True, event_id=9,
        ) == {"status": "ok"}
    assert context.entered == 1
    assert context.exited == 1
