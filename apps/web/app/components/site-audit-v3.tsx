"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type Brief = {
  url: string;
  companyName: string;
  industry: string;
  targetAudience: string;
  primaryGoal: string;
  mainProblem: string;
  primaryAction: string;
  market: string;
  competitors: string[];
};
type Finding = {
  id?: string;
  severity: "P0" | "P1" | "P2" | "P3";
  category: string;
  evidenceKind: "MEASURED" | "COMPUTED" | "AI_ASSESSMENT";
  title: string;
  finding: string;
  location?: string | null;
  selector?: string | null;
  evidence: string;
  impact: string;
  recommendation: string;
  ownerRole?: string | null;
  effort?: string | null;
};
type Score = {
  id: string;
  label: string;
  value: number;
  passed: number;
  applicable: number;
  origin: string;
};
type Audit = {
  id: string;
  normalizedUrl: string;
  status:
    | "QUEUED"
    | "CRAWLING"
    | "BROWSER_ANALYSIS"
    | "SEO_ANALYSIS"
    | "PERFORMANCE"
    | "AI_ANALYSIS"
    | "REPORTING"
    | "COMPLETED"
    | "FAILED";
  stage: string;
  progress: number;
  pagesFound: number;
  pagesChecked: number;
  coverageSampled: boolean;
  elapsedMs?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  brief?: Partial<Brief> | null;
  scores?: Score[] | null;
  summary?: {
    executiveSummary?: string;
    topPriorities?: Finding[];
    audience?: Record<string, string>;
    methodology?: string;
    fieldData?: string;
    gsc?: string;
    competitors?: Array<{
      url: string;
      status: string;
      title?: string | null;
      h1?: string | null;
      hasCta?: boolean;
      hasTrust?: boolean;
      hasCanonical?: boolean;
      responseMs?: number;
    }>;
  } | null;
  findings?: Finding[];
  metrics?: Array<{
    metricKey: string;
    label: string;
    value: number | string | null;
    unit?: string | null;
    source: string;
  }>;
  screenshots?: Array<{ kind: string; domMap?: DomZone[] | null }>;
  report?: { generatedAt: string } | null;
  searchConsole?: {
    status: string;
    metrics?: {
      clicks?: number;
      impressions?: number;
      ctr?: number;
      position?: number;
    };
    topQueries?: Array<{
      keys?: string[];
      clicks?: number;
      impressions?: number;
    }>;
  };
  issueCounts?: Record<string, number>;
};
type DomZone = {
  label: string;
  selector: string;
  text: string;
  box: { x: number; y: number; width: number; height: number };
};

const blankBrief = (): Brief => ({
  url: "",
  companyName: "",
  industry: "",
  targetAudience: "",
  primaryGoal: "",
  mainProblem: "",
  primaryAction: "",
  market: "",
  competitors: ["", "", ""],
});
const statusCopy: Record<Audit["status"], string> = {
  QUEUED: "В очереди",
  CRAWLING: "Изучаем структуру",
  BROWSER_ANALYSIS: "Проверяем первый экран",
  SEO_ANALYSIS: "Анализируем SEO",
  PERFORMANCE: "Проверяем скорость",
  AI_ANALYSIS: "Формируем рекомендации",
  REPORTING: "Готовим Word-отчёт",
  COMPLETED: "Готово",
  FAILED: "Не удалось завершить",
};
const stageOrder = [
  "preparing_site",
  "checking_pages",
  "first_screen",
  "checking_seo",
  "measuring_speed",
  "forming_recommendations",
  "preparing_report",
];

export function SiteAuditV3({
  workspaceId,
  csrf,
  notify,
  fail,
}: {
  workspaceId: string;
  csrf: () => Promise<string>;
  notify: (message: string) => void;
  fail: (message: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [brief, setBrief] = useState<Brief>(blankBrief);
  const [history, setHistory] = useState<Audit[]>([]);
  const [selected, setSelected] = useState<Audit | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false);

  const running =
    selected && !["COMPLETED", "FAILED"].includes(selected.status);
  const zones = (
    selected?.screenshots?.find((item) => item.kind === "DESKTOP_SCREENSHOT")
      ?.domMap ?? []
  ).filter((item): item is DomZone => Boolean(item && item.box));

  useEffect(() => {
    void loadHistory();
  }, [workspaceId]);
  useEffect(() => {
    if (!selected || !running) return;
    const timer = window.setInterval(() => void loadAudit(selected.id), 3_000);
    return () => window.clearInterval(timer);
  }, [selected?.id, running]);

  async function loadHistory() {
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspaceId}/site-audits`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) return;
    const data = (await response.json()) as { items: Audit[] };
    setHistory(data.items);
    if (!selected && data.items[0]) void loadAudit(data.items[0].id);
  }
  async function loadAudit(id: string) {
    const response = await fetch(
      `${API}/api/v1/workspaces/${workspaceId}/site-audits/${id}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) return;
    const data = (await response.json()) as Audit;
    setSelected(data);
    setHistory((items) =>
      items.map((item) => (item.id === data.id ? { ...item, ...data } : item)),
    );
  }
  async function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brief.url.trim()) return;
    setSubmitting(true);
    try {
      const response = await fetch(
        `${API}/api/v1/workspaces/${workspaceId}/site-audits`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": await csrf(),
          },
          body: JSON.stringify({
            ...brief,
            competitors: brief.competitors.filter(Boolean),
          }),
        },
      );
      const data = (await response.json()) as Audit & {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(data.error?.message ?? "Не удалось запустить анализ.");
      setSelected(data);
      setHistory((items) => [data, ...items]);
      setStep(3);
      notify("Анализ запущен. Прогресс отражает работу фонового процесса.");
    } catch (error) {
      fail(
        error instanceof Error ? error.message : "Не удалось запустить анализ.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  const priorities = useMemo(
    () =>
      selected?.summary?.topPriorities ??
      selected?.findings
        ?.filter((item) => item.severity === "P0" || item.severity === "P1")
        .slice(0, 5) ??
      [],
    [selected],
  );
  const byRole = useMemo(() => {
    const groups: Record<string, Finding[]> = {};
    for (const finding of selected?.findings ?? []) {
      const role = finding.ownerRole || "Команде";
      (groups[role] ??= []).push(finding);
    }
    return groups;
  }, [selected]);

  return (
    <section
      className="section site-audit-v3"
      aria-labelledby="site-audit-title"
    >
      <div className="section-head">
        <div>
          <p className="eyebrow">AI Website Audit V3</p>
          <h1 id="site-audit-title">Анализ сайта</h1>
          <p className="section-head__sub">
            Не просто балл: где проблема, чем она подтверждена, почему важна и
            кому её исправлять.
          </p>
        </div>
      </div>
      <div className="site-audit-v3__stepper" aria-label="Этапы запуска">
        {["Сайт", "Задача бизнеса", "Запуск"].map((label, index) => (
          <button
            key={label}
            type="button"
            className={step === index + 1 ? "is-active" : ""}
            aria-current={step === index + 1 ? "step" : undefined}
            onClick={() => setStep(index + 1)}
            disabled={index + 1 === 3 && !selected}
          >
            {index + 1}. {label}
          </button>
        ))}
      </div>
      <form className="panel site-audit-v3__brief" onSubmit={launch}>
        {step === 1 && (
          <fieldset>
            <legend>Шаг 1. Сайт</legend>
            <div className="site-audit-v3__grid">
              <label className="site-audit-v3__wide">
                URL сайта{" "}
                <input
                  type="url"
                  required
                  autoComplete="url"
                  value={brief.url}
                  onChange={(event) =>
                    setBrief({ ...brief, url: event.target.value })
                  }
                  placeholder="https://example.com"
                  aria-describedby="audit-url-note"
                />
              </label>
              <label>
                Название компании / проекта{" "}
                <input
                  value={brief.companyName}
                  maxLength={160}
                  onChange={(event) =>
                    setBrief({ ...brief, companyName: event.target.value })
                  }
                />
              </label>
              <label>
                Сфера бизнеса{" "}
                <input
                  value={brief.industry}
                  maxLength={160}
                  onChange={(event) =>
                    setBrief({ ...brief, industry: event.target.value })
                  }
                  placeholder="Например, клиника или B2B SaaS"
                />
              </label>
            </div>
            <p id="audit-url-note" className="field-note">
              Проверяем только публичные HTTP(S)-страницы. Вход, формы и любые
              изменения сайта исключены.
            </p>
            <div className="site-audit-v3__actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => setStep(2)}
              >
                Далее
              </button>
            </div>
          </fieldset>
        )}
        {step === 2 && (
          <fieldset>
            <legend>Шаг 2. Задача бизнеса</legend>
            <div className="site-audit-v3__grid">
              <label className="site-audit-v3__wide">
                Целевая аудитория{" "}
                <textarea
                  value={brief.targetAudience}
                  maxLength={2000}
                  onChange={(event) =>
                    setBrief({ ...brief, targetAudience: event.target.value })
                  }
                  placeholder="Кто основной клиент сайта?"
                />
              </label>
              <label>
                Главная цель сайта{" "}
                <select
                  value={brief.primaryGoal}
                  onChange={(event) =>
                    setBrief({ ...brief, primaryGoal: event.target.value })
                  }
                >
                  <option value="">Выберите цель</option>
                  <option>Заявки</option>
                  <option>Продажи</option>
                  <option>Запись</option>
                  <option>Звонки</option>
                  <option>Регистрация</option>
                  <option>Информирование</option>
                  <option>Другое</option>
                </select>
              </label>
              <label>
                Главное целевое действие{" "}
                <input
                  value={brief.primaryAction}
                  maxLength={500}
                  onChange={(event) =>
                    setBrief({ ...brief, primaryAction: event.target.value })
                  }
                  placeholder="Например, оставить заявку"
                />
              </label>
              <label className="site-audit-v3__wide">
                Главная проблема{" "}
                <textarea
                  value={brief.mainProblem}
                  maxLength={2000}
                  onChange={(event) =>
                    setBrief({ ...brief, mainProblem: event.target.value })
                  }
                  placeholder="Например, мало заявок или сайт выглядит устаревшим"
                />
              </label>
              <label>
                География / рынок{" "}
                <input
                  value={brief.market}
                  maxLength={500}
                  onChange={(event) =>
                    setBrief({ ...brief, market: event.target.value })
                  }
                  placeholder="Необязательно"
                />
              </label>
            </div>
            <fieldset className="site-audit-v3__competitors">
              <legend>Конкуренты (до 3 URL, необязательно)</legend>
              {brief.competitors.map((value, index) => (
                <label key={index}>
                  Конкурент {index + 1}
                  <input
                    type="url"
                    value={value}
                    onChange={(event) => {
                      const competitors = [...brief.competitors];
                      competitors[index] = event.target.value;
                      setBrief({ ...brief, competitors });
                    }}
                    placeholder="https://competitor.example"
                  />
                </label>
              ))}
            </fieldset>
            <div className="site-audit-v3__actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setStep(1)}
              >
                Назад
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => setStep(3)}
              >
                Посмотреть summary
              </button>
            </div>
          </fieldset>
        )}
        {step === 3 && !selected && (
          <fieldset>
            <legend>Шаг 3. Запуск</legend>
            <div className="site-audit-v3__summary">
              <strong>{brief.url || "URL не указан"}</strong>
              <span>
                {brief.companyName || "Компания не указана"} ·{" "}
                {brief.industry || "Сфера не указана"}
              </span>
              <span>
                Цель: {brief.primaryGoal || "не выбрана"} · Действие:{" "}
                {brief.primaryAction || "не указано"}
              </span>
              <span>
                Аудит: crawl → браузер → SEO → Lighthouse → accessibility →
                ссылки → отчёт Word.
              </span>
            </div>
            <div className="site-audit-v3__actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setStep(2)}
              >
                Назад
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={submitting}
              >
                {submitting ? "Запускаем…" : "Запустить анализ"}
              </button>
            </div>
          </fieldset>
        )}
      </form>
      {selected && (
        <AuditResults
          audit={selected}
          workspaceId={workspaceId}
          priorities={priorities}
          zones={zones}
          showMarkers={showMarkers}
          setShowMarkers={setShowMarkers}
          byRole={byRole}
          onSelectHistory={(id) => void loadAudit(id)}
          onStartNew={() => {
            setSelected(null);
            setBrief(blankBrief());
            setStep(1);
          }}
          history={history}
        />
      )}
    </section>
  );
}

function AuditResults({
  audit,
  workspaceId,
  priorities,
  zones,
  showMarkers,
  setShowMarkers,
  byRole,
  history,
  onSelectHistory,
  onStartNew,
}: {
  audit: Audit;
  workspaceId: string;
  priorities: Finding[];
  zones: DomZone[];
  showMarkers: boolean;
  setShowMarkers: (value: boolean) => void;
  byRole: Record<string, Finding[]>;
  history: Audit[];
  onSelectHistory: (id: string) => void;
  onStartNew: () => void;
}) {
  const running = !["COMPLETED", "FAILED"].includes(audit.status);
  const currentStage = Math.max(0, stageOrder.indexOf(audit.stage));
  const desktop = `${API}/api/v1/workspaces/${workspaceId}/site-audits/${audit.id}/screenshot?kind=desktop`;
  const previous = history.find(
    (item) =>
      item.id !== audit.id &&
      item.status === "COMPLETED" &&
      item.normalizedUrl === audit.normalizedUrl,
  );
  return (
    <div className="site-audit-v3__results" aria-live="polite">
      {running && (
        <section className="panel site-audit-v3__progress">
          <div>
            <span className="eyebrow">{statusCopy[audit.status]}</span>
            <h2>
              {Math.max(0, audit.progress)}% · {audit.pagesChecked} страниц
              проверено
            </h2>
            <p>
              {audit.pagesFound
                ? `Найдено страниц: ${audit.pagesFound}.`
                : "Подготавливаем публичный сайт."}{" "}
              {audit.elapsedMs
                ? `Прошло ${Math.max(1, Math.round(audit.elapsedMs / 1000))} сек.`
                : ""}
            </p>
          </div>
          <ol>
            {stageOrder.map((stage, index) => (
              <li
                className={index <= currentStage ? "is-done" : ""}
                key={stage}
              >
                {
                  [
                    "Подготавливаем сайт",
                    "Изучаем структуру",
                    "Анализируем первый экран",
                    "Проверяем SEO",
                    "Проверяем скорость",
                    "Формируем рекомендации",
                    "Готовим отчёт",
                  ][index]
                }
              </li>
            ))}
          </ol>
        </section>
      )}
      {audit.status === "FAILED" && (
        <section className="panel site-audit-v3__failure">
          <h2>Аудит не завершён</h2>
          <p>
            {audit.errorMessage ||
              "Сайт не позволил безопасно выполнить проверку."}
          </p>
          <p>
            Отчёт не сформирован, чтобы не показывать неподтверждённые выводы.
          </p>
        </section>
      )}
      {audit.status === "COMPLETED" && (
        <>
          <section className="panel site-audit-v3__overview">
            <div>
              <p className="eyebrow">Готовый аудит</p>
              <h2>{audit.normalizedUrl}</h2>
              <p>{audit.summary?.executiveSummary}</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={onStartNew}
            >
              Новый анализ
            </button>
            <dl>
              <div>
                <dt>Проверено страниц</dt>
                <dd>
                  {audit.pagesChecked}
                  {audit.coverageSampled ? ` из ${audit.pagesFound}` : ""}
                </dd>
              </div>
              <div>
                <dt>Critical / High</dt>
                <dd>
                  {(audit.issueCounts?.P0 ?? 0) + (audit.issueCounts?.P1 ?? 0)}
                </dd>
              </div>
              <div>
                <dt>Найдено проблем</dt>
                <dd>{audit.findings?.length ?? 0}</dd>
              </div>
            </dl>
          </section>
          <section className="site-audit-v3__scores" aria-label="Оценки аудита">
            {(audit.scores ?? []).map((score) => (
              <article key={score.id}>
                <strong>{score.value}</strong>
                <span>{score.label}</span>
                <small>
                  {score.passed} из {score.applicable} применимых checks
                  пройдены
                </small>
              </article>
            ))}
          </section>
          {previous?.scores && (
            <section className="panel">
              <p className="eyebrow">Было / Стало</p>
              <h2>Сравнение с предыдущим аудитом</h2>
              <div className="site-audit-v3__scores">
                {(audit.scores ?? []).map((score) => {
                  const before = previous.scores?.find(
                    (item) => item.id === score.id,
                  )?.value;
                  return (
                    <article key={score.id}>
                      <strong>
                        {before ?? "—"} → {score.value}
                      </strong>
                      <span>{score.label}</span>
                      <small>
                        Critical: {previous.issueCounts?.P0 ?? 0} →{" "}
                        {audit.issueCounts?.P0 ?? 0}
                      </small>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {(audit.metrics?.length ?? 0) > 0 && (
            <section className="panel">
              <p className="eyebrow">Измерения</p>
              <h2>Performance и технические метрики</h2>
              <div className="site-audit-v3__scores">
                {audit.metrics
                  ?.filter((item) =>
                    /lighthouse|lcp|cls|tbt|fcp|speed/i.test(item.metricKey),
                  )
                  .map((item) => (
                    <article key={item.metricKey}>
                      <strong>{formatMetric(item.value, item.unit)}</strong>
                      <span>{item.label}</span>
                      <small>{item.source}</small>
                    </article>
                  ))}
              </div>
            </section>
          )}
          <section className="panel">
            <div className="site-audit-v3__section-head">
              <div>
                <p className="eyebrow">Главные приоритеты</p>
                <h2>Что исправить в первую очередь</h2>
              </div>
              <a
                className="primary-button"
                href={`${API}/api/v1/workspaces/${workspaceId}/site-audits/${audit.id}/report.docx`}
              >
                Скачать Word
              </a>
            </div>
            <div className="site-audit-v3__finding-list">
              {priorities.map((item, index) => (
                <FindingCard
                  key={item.id ?? `${item.title}-${index}`}
                  item={item}
                  number={index + 1}
                />
              ))}
            </div>
          </section>
          <section className="panel site-audit-v3__visual">
            <div className="site-audit-v3__section-head">
              <div>
                <p className="eyebrow">Первый экран</p>
                <h2>Визуальная проверка</h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                aria-pressed={showMarkers}
                onClick={() => setShowMarkers(!showMarkers)}
              >
                {showMarkers ? "Скрыть маркеры" : "Показать проблемы на экране"}
              </button>
            </div>
            <div className="site-audit-v3__screenshot">
              {
                <img
                  src={desktop}
                  alt="Первый экран проанализированного сайта"
                />
              }
              {showMarkers &&
                zones.map((zone, index) => (
                  <span
                    className="site-audit-v3__marker"
                    key={zone.selector}
                    style={{
                      left: `${Math.min(94, Math.max(1, zone.box.x / 14.4))}%`,
                      top: `${Math.min(94, Math.max(1, zone.box.y / 9))}%`,
                    }}
                  >
                    {index + 1}
                  </span>
                ))}
            </div>
            {zones.length > 0 && (
              <ol className="site-audit-v3__zones">
                {zones.map((zone, index) => (
                  <li key={zone.selector}>
                    <strong>
                      {index + 1} — {zone.label}
                    </strong>
                    <span>{zone.text || "Элемент найден в DOM."}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="panel">
            <p className="eyebrow">Задачи по ролям</p>
            <h2>Кому что делать</h2>
            <div className="site-audit-v3__roles">
              {Object.entries(byRole).map(([role, items]) => (
                <article key={role}>
                  <h3>{role}</h3>
                  <ul>
                    {items.slice(0, 8).map((item) => (
                      <li key={item.id ?? item.title}>{item.title}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
          <section className="panel">
            <p className="eyebrow">Все findings</p>
            <h2>Детали с evidence</h2>
            <div className="site-audit-v3__finding-list">
              {(audit.findings ?? []).map((item, index) => (
                <FindingCard
                  key={item.id ?? `${item.title}-${index}`}
                  item={item}
                  number={index + 1}
                />
              ))}
            </div>
          </section>
          <section className="panel site-audit-v3__method">
            <h2>Методика и ограничения</h2>
            <p>{audit.summary?.methodology}</p>
            <p>{audit.summary?.fieldData}</p>
            <p>{audit.summary?.gsc}</p>
          </section>
          {(audit.summary?.competitors?.length ?? 0) > 0 && (
            <section className="panel">
              <p className="eyebrow">Конкуренты</p>
              <h2>Сокращённое сравнение</h2>
              <div className="site-audit-v3__roles">
                {audit.summary?.competitors?.map((item) => (
                  <article key={item.url}>
                    <h3>{item.url}</h3>
                    {item.status === "ok" ? (
                      <ul>
                        <li>Hero: {item.h1 || "не найден"}</li>
                        <li>CTA: {item.hasCta ? "найден" : "не найден"}</li>
                        <li>Trust: {item.hasTrust ? "найден" : "не найден"}</li>
                        <li>Canonical: {item.hasCanonical ? "есть" : "нет"}</li>
                        <li>Ответ: {item.responseMs ?? "—"} мс</li>
                      </ul>
                    ) : (
                      <p>Недоступен для безопасного сокращённого crawl.</p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          {audit.searchConsole?.status === "connected" && (
            <section className="panel">
              <p className="eyebrow">Google Search Console</p>
              <h2>Реальные поисковые данные</h2>
              <div className="site-audit-v3__scores">
                <article>
                  <strong>{audit.searchConsole.metrics?.clicks ?? 0}</strong>
                  <span>Клики</span>
                </article>
                <article>
                  <strong>
                    {audit.searchConsole.metrics?.impressions ?? 0}
                  </strong>
                  <span>Показы</span>
                </article>
                <article>
                  <strong>{audit.searchConsole.metrics?.ctr ?? 0}</strong>
                  <span>CTR</span>
                </article>
                <article>
                  <strong>{audit.searchConsole.metrics?.position ?? 0}</strong>
                  <span>Средняя позиция</span>
                </article>
              </div>
              <p className="field-note">
                Данные получены только из подключённого Search Console текущего
                workspace.
              </p>
            </section>
          )}
        </>
      )}
      <section className="panel site-audit-v3__history">
        <p className="eyebrow">История аудитов</p>
        <h2>Повторные проверки и сравнение</h2>
        <div>
          {history.map((item) => (
            <button
              type="button"
              className={item.id === audit.id ? "is-active" : ""}
              onClick={() => onSelectHistory(item.id)}
              key={item.id}
            >
              <strong>{item.normalizedUrl}</strong>
              <span>
                {new Date(item.createdAt).toLocaleDateString("ru-RU")} ·{" "}
                {statusCopy[item.status]}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function FindingCard({ item, number }: { item: Finding; number: number }) {
  return (
    <article
      className={`site-audit-v3__finding severity-${item.severity.toLowerCase()}`}
    >
      <span className="site-audit-v3__priority">
        {number}. {item.severity}
      </span>
      <div>
        <h3>{item.title}</h3>
        <p>
          <strong>Что найдено:</strong> {item.finding}
        </p>
        <p>
          <strong>Где:</strong> {item.location || "страница сайта"}
        </p>
        <p>
          <strong>Evidence:</strong> {item.evidence}
        </p>
        <p>
          <strong>Почему это проблема:</strong> {item.impact}
        </p>
        <p>
          <strong>Что сделать:</strong> {item.recommendation}
        </p>
        <small>
          {item.evidenceKind === "MEASURED"
            ? "Измерено инструментом"
            : item.evidenceKind === "AI_ASSESSMENT"
              ? "Экспертная AI-оценка"
              : "Вычислено по правилам"}
          {item.ownerRole ? ` · ${item.ownerRole}` : ""}
          {item.effort ? ` · ${item.effort}` : ""}
        </small>
      </div>
    </article>
  );
}
function formatMetric(value: number | string | null, unit?: string | null) {
  if (value === null || value === undefined || value === "")
    return "Нет данных";
  const numeric = Number(value);
  const display = Number.isFinite(numeric)
    ? new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: unit === "score" ? 3 : 0,
      }).format(numeric)
    : String(value);
  return `${display}${unit && unit !== "/100" ? ` ${unit}` : ""}`;
}
