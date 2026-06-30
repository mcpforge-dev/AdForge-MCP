from ad_mcp.settings import Settings
from ad_mcp.web.site_analysis_history import SiteAnalysisHistoryStore


def test_site_analysis_history_is_scoped_by_user(tmp_path) -> None:
    store = SiteAnalysisHistoryStore(Settings(project_root=tmp_path))

    store.save("user-a", {"status": "ok", "url": "https://a.example", "overall_score": 71, "summary": "A"})
    store.save("user-b", {"status": "ok", "url": "https://b.example", "overall_score": 82, "summary": "B"})

    assert store.list_for_user("user-a")[0]["url"] == "https://a.example"
    assert store.list_for_user("user-b")[0]["url"] == "https://b.example"


def test_site_analysis_history_keeps_last_five(tmp_path) -> None:
    store = SiteAnalysisHistoryStore(Settings(project_root=tmp_path))

    for index in range(7):
        store.save("user-a", {"status": "ok", "url": f"https://example.com/{index}", "overall_score": index})

    items = store.list_for_user("user-a")

    assert len(items) == 5
    assert items[0]["url"] == "https://example.com/6"
    assert items[-1]["url"] == "https://example.com/2"
