const ranks = ["부장", "차장", "과장", "팀장", "대리", "주임", "선임사원", "사원", "신입"];
const hmApiBaseUrl = "https://asg-b2.onrender.com";
const hmSeasonApiPaths = {
  5: "d",
  6: "b",
};
const hmMemberAliases = {
  이서냥: "서냥",
  차지오: "지오",
};
const failedLoginRedirectUrl = "https://www.sooplive.co.kr";
const failedLoginLimit = 5;
const passwordPattern = /^[A-Za-z0-9]+$/;
const failedLoginCountKey = "seasonContributionFailedLoginCount";
const failedLoginRedirectKey = "seasonContributionWasRedirected";

const sampleMembers = [
  { id: "yeori", baseRank: "부장", name: "여리", baseScore: 0 },
  { id: "eopu", baseRank: "차장", name: "어푸", baseScore: 0 },
  { id: "dana", baseRank: "과장", name: "다나", baseScore: 0 },
  { id: "dalli", baseRank: "팀장", name: "달리", baseScore: 0 },
  { id: "yuna", baseRank: "대리", name: "유나", baseScore: 0 },
  { id: "iseonyang", baseRank: "주임", name: "이서냥", baseScore: 0 },
  { id: "segyo", baseRank: "사원", name: "세교", baseScore: 0 },
  { id: "chajio", baseRank: "신입", name: "차지오", baseScore: 0 },
];

const sampleEntries = [
  ["1회차", "yeori", 175021], ["1회차", "eopu", 103322], ["1회차", "dana", 72160], ["1회차", "dalli", 66140],
  ["1회차", "yuna", 46215], ["1회차", "iseonyang", 33524],
  ["2회차", "yeori", 142041], ["2회차", "eopu", 110397], ["2회차", "dana", 100606], ["2회차", "dalli", 46110],
  ["2회차", "yuna", 30010], ["2회차", "iseonyang", 25627], ["2회차", "segyo", 13359],
  ["3회차", "yeori", 142590], ["3회차", "eopu", 50219], ["3회차", "dana", 86867], ["3회차", "dalli", 28207],
  ["3회차", "yuna", 25790], ["3회차", "iseonyang", 37632], ["3회차", "segyo", 14691],
  ["4회차", "yeori", 282350], ["4회차", "eopu", 80861], ["4회차", "dana", 114102], ["4회차", "dalli", 98021],
  ["4회차", "yuna", 47491], ["4회차", "iseonyang", 30085],
  ["5회차", "yeori", 76048], ["5회차", "eopu", 35457], ["5회차", "dana", 44755], ["5회차", "dalli", 87002],
  ["5회차", "yuna", 48283], ["5회차", "iseonyang", 28237], ["5회차", "segyo", 3460],
  ["6회차", "yeori", 90553], ["6회차", "eopu", 115592], ["6회차", "dana", 32578], ["6회차", "dalli", 69213],
  ["6회차", "yuna", 45500], ["6회차", "iseonyang", 38711], ["6회차", "segyo", 17177],
  ["7회차", "yeori", 21827], ["7회차", "eopu", 88284], ["7회차", "dana", 37485], ["7회차", "dalli", 59096],
  ["7회차", "yuna", 21526], ["7회차", "iseonyang", 32242], ["7회차", "segyo", 8140], ["7회차", "chajio", 14358],
].map(([round, memberId, score], index) => ({
  id: `season5-${index + 1}`,
  memberId,
  round,
  score,
  reason: "",
  createdAt: "시즌5 시트 반영",
}));

const sampleSeason = {
  id: "season5",
  season: "시즌5",
  roundCount: 7,
  members: sampleMembers,
  entries: sampleEntries,
  extraContributions: {},
  hmServerScores: {},
  hmServerMeta: {},
  earlyLeaveRounds: {},
  finalRoundFullRounds: {},
};

const sampleState = {
  dataVersion: 3,
  currentSeasonId: "season5",
  seasons: [sampleSeason],
};

let appState = loadState();
let state = getCurrentSeason();
let serverStateLoaded = false;
let saveStateTimer = null;
let lastSavedStateJson = "";

const $ = (selector) => document.querySelector(selector);
const formatNumber = (value) => Number(value || 0).toLocaleString("ko-KR");
const roundName = (index) => `${index}회차`;
let currentUser = null;
let isAdmin = false;

function loadState() {
  const saved = localStorage.getItem("seasonContributionState");
  if (!saved) return structuredClone(sampleState);

  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed.seasons)) {
      const seasons = sortSeasonsByLatest(parsed.seasons.length ? parsed.seasons.map(normalizeSeason) : [structuredClone(sampleSeason)]);
      return {
        ...sampleState,
        ...parsed,
        seasons,
        currentSeasonId: parsed.currentSeasonId || seasons[0]?.id || sampleState.currentSeasonId,
      };
    }
    return migrateSingleSeasonState(parsed);
  } catch {
    return structuredClone(sampleState);
  }
}

function saveState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => persistState(), 180);
}

function persistState({ syncServer = true } = {}) {
  saveStateTimer = null;
  const stateJson = JSON.stringify(appState);
  if (stateJson === lastSavedStateJson) return;

  lastSavedStateJson = stateJson;
  localStorage.setItem("seasonContributionState", stateJson);

  if (!syncServer || !currentUser || !isAdmin || !serverStateLoaded || isLocalPreview()) return;

  fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: `{"state":${stateJson}}`,
  }).catch(() => {});
}

function applyServerState(serverState) {
  const seasons = sortSeasonsByLatest(serverState.seasons.map(normalizeSeason));
  appState = {
    ...sampleState,
    ...serverState,
    seasons,
    currentSeasonId: seasons.some((season) => season.id === serverState.currentSeasonId)
      ? serverState.currentSeasonId
      : seasons[0]?.id || sampleState.currentSeasonId,
  };
  state = getCurrentSeason();
  lastSavedStateJson = JSON.stringify(appState);
  localStorage.setItem("seasonContributionState", lastSavedStateJson);
}

function flushStateSave() {
  if (!saveStateTimer) return;
  clearTimeout(saveStateTimer);
  persistState({ syncServer: false });
}

async function loadServerState() {
  serverStateLoaded = false;
  if (!currentUser || isLocalPreview()) {
    serverStateLoaded = true;
    return;
  }

  try {
    const response = await fetch("/api/state", { credentials: "include" });
    const data = response.ok ? await response.json() : {};
    if (data.state?.seasons?.length) {
      applyServerState(data.state);
    }
  } catch {
    // Keep local data if the server state cannot be loaded.
  } finally {
    serverStateLoaded = true;
  }
}

function normalizeSeason(season) {
  const ignoresBaseScore = shouldIgnoreBaseScore(season.season);
  return {
    id: season.id || makeSeasonId(season.season || "새 시즌"),
    season: season.season || "새 시즌",
    roundCount: Number(season.roundCount) || 1,
    members: (season.members || []).map((member) => ({
      ...member,
      baseScore: ignoresBaseScore ? 0 : Number(member.baseScore) || 0,
    })),
    entries: season.entries || [],
    extraContributions: season.extraContributions || {},
    hmServerScores: season.hmServerScores || {},
    hmServerMeta: season.hmServerMeta || {},
    earlyLeaveRounds: season.earlyLeaveRounds || {},
    finalRoundFullRounds: season.finalRoundFullRounds || {},
  };
}

function migrateSingleSeasonState(parsed) {
  const migratedSeason = normalizeSeason({
    id: makeSeasonId(parsed.season || "시즌5"),
    season: parsed.season || "시즌5",
    roundCount: parsed.roundCount || 7,
    members: parsed.members || sampleMembers,
    entries: parsed.entries || sampleEntries,
    extraContributions: parsed.extraContributions || {},
    hmServerScores: parsed.hmServerScores || {},
    hmServerMeta: parsed.hmServerMeta || {},
    earlyLeaveRounds: parsed.earlyLeaveRounds || {},
    finalRoundFullRounds: parsed.finalRoundFullRounds || {},
  });
  return {
    dataVersion: sampleState.dataVersion,
    currentSeasonId: migratedSeason.id,
    seasons: sortSeasonsByLatest([migratedSeason]),
  };
}

function makeSeasonId(name) {
  const slug = String(name || "season").trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "season"}-${Date.now().toString(36)}`;
}

function sortSeasonsByLatest(seasons) {
  return [...seasons].sort((a, b) => {
    const left = getSeasonNumber(a.season);
    const right = getSeasonNumber(b.season);
    if (left !== right) return (right ?? -Infinity) - (left ?? -Infinity);
    return String(b.season || "").localeCompare(String(a.season || ""), "ko-KR");
  });
}

function getNextSeasonNumber() {
  const numbers = appState.seasons
    .map((season) => String(season.season || "").match(/시즌\s*(\d+)/))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return Math.max(0, ...numbers) + 1;
}

function cloneMembersForNewSeason(members = []) {
  return members.map((member) => ({
    id: crypto.randomUUID(),
    baseRank: member.baseRank || "신입",
    name: member.name || "새 멤버",
    baseScore: 0,
  }));
}

function getPreviousSeasonForCurrent() {
  const currentNumber = getSeasonNumber(state.season);
  const candidates = appState.seasons.filter((season) => season.id !== state.id && Array.isArray(season.members) && season.members.length);
  return (
    candidates.find((season) => getSeasonNumber(season.season) < currentNumber) ||
    candidates.find((season) => getSeasonNumber(season.season) > currentNumber) ||
    candidates[0]
  );
}

function getCurrentSeason() {
  return appState.seasons.find((season) => season.id === appState.currentSeasonId) || appState.seasons[0];
}

function setCurrentSeason(seasonId) {
  appState.currentSeasonId = seasonId;
  state = getCurrentSeason();
  saveState();
}

function addSeason({ copyMembers = false } = {}) {
  const nextNumber = getNextSeasonNumber();
  const sourceSeason = state;
  const season = normalizeSeason({
    id: makeSeasonId(`시즌${nextNumber}`),
    season: `시즌${nextNumber}`,
    roundCount: Number(sourceSeason.roundCount) || 7,
    members: copyMembers ? cloneMembersForNewSeason(sourceSeason.members) : [],
    entries: [],
  });
  appState.seasons.unshift(season);
  appState.seasons = sortSeasonsByLatest(appState.seasons);
  setCurrentSeason(season.id);
  return season;
}

function importMembersFromPreviousSeason() {
  const sourceSeason = getPreviousSeasonForCurrent();
  if (!sourceSeason) return null;
  state.members = cloneMembersForNewSeason(sourceSeason.members);
  state.entries = [];
  state.extraContributions = {};
  state.hmServerScores = {};
  state.hmServerMeta = {};
  return sourceSeason;
}

function deleteCurrentSeason() {
  if (appState.seasons.length <= 1) return null;

  const deletedSeason = state;
  const deletedIndex = appState.seasons.findIndex((season) => season.id === state.id);
  appState.seasons = sortSeasonsByLatest(appState.seasons.filter((season) => season.id !== state.id));
  const nextSeason = appState.seasons[Math.max(0, deletedIndex - 1)] || appState.seasons[0];
  setCurrentSeason(nextSeason.id);
  return deletedSeason;
}

function getRounds() {
  return Array.from({ length: Number(state.roundCount) || 1 }, (_, index) => roundName(index + 1));
}

function getRoundIndex(round) {
  const match = String(round || "").match(/^(\d+)회차$/);
  return match ? Number(match[1]) : 0;
}

function getRoundEntryScore(member, round) {
  const entries = state.entries.filter((entry) => entry.memberId === member.id && entry.round === round);
  return Number(entries.at(-1)?.score || 0);
}

function getRoundExtraContribution(member, round) {
  const value = state.extraContributions?.[round]?.[member.id];
  return typeof value === "number" ? value : 0;
}

function getRoundScore(member, round) {
  return getRoundEntryScore(member, round) + getRoundExtraContribution(member, round);
}

function getHmMemberName(member) {
  return hmMemberAliases[member.name] || member.name;
}

function normalizeHmName(value) {
  return String(value ?? "").replace(/[\u200b-\u200d\ufeff-]/g, "").trim();
}

function getHmServerScore(member, round) {
  const value = state.hmServerScores?.[round]?.[member.id];
  return typeof value === "number" ? value : null;
}

function hasHmScoresForRound(round) {
  return Boolean(state.hmServerScores?.[round]);
}

function isEarlyLeaveRound(round) {
  return Boolean(state.earlyLeaveRounds?.[round]);
}

function setEarlyLeaveRound(round, enabled) {
  state.earlyLeaveRounds ||= {};
  if (enabled) {
    state.earlyLeaveRounds[round] = true;
    return;
  }

  delete state.earlyLeaveRounds[round];
}

function isFinalRoundFullRound(round) {
  return Boolean(state.finalRoundFullRounds?.[round]);
}

function setFinalRoundFullRound(round, enabled) {
  state.finalRoundFullRounds ||= {};
  if (enabled) {
    state.finalRoundFullRounds[round] = true;
    return;
  }

  delete state.finalRoundFullRounds[round];
}

function setRoundExtraContribution(memberId, round, score) {
  state.extraContributions ||= {};
  state.extraContributions[round] ||= {};

  if (score > 0) {
    state.extraContributions[round][memberId] = score;
    return;
  }

  delete state.extraContributions[round][memberId];
  if (!Object.keys(state.extraContributions[round]).length) {
    delete state.extraContributions[round];
  }
}

function getMemberTotal(member, round) {
  const base = shouldIgnoreBaseScore(state.season) ? 0 : Number(member.baseScore) || 0;
  const selectedRoundIndex = getRoundIndex(round);
  const added = getRounds()
    .filter((item) => {
      if (!round) return true;
      return getRoundIndex(item) <= selectedRoundIndex;
    })
    .reduce((sum, item) => sum + getRoundScore(member, item), 0);
  return base + added;
}

function getFinalRoundBonus(member, round) {
  if (!isFinalRoundFullRound(round)) return 0;
  return getRoundScore(member, round);
}

function getSeventyScore(member, round, total) {
  const finalRoundBonus = getFinalRoundBonus(member, round);
  return Math.round((Number(total || 0) - finalRoundBonus) * 0.7) + finalRoundBonus;
}

function compareResultMembers(a, b) {
  const hmLeft = a.hmServerScore ?? -1;
  const hmRight = b.hmServerScore ?? -1;
  return (
    b.total - a.total ||
    b.roundScore - a.roundScore ||
    hmRight - hmLeft ||
    String(a.name || "").localeCompare(String(b.name || ""), "ko-KR")
  );
}

function getResults(round) {
  return state.members
    .map((member) => {
      const total = getMemberTotal(member, round);
      const hmServerScore = getHmServerScore(member, round);
      const roundScore = getRoundScore(member, round);
      const finalRoundBonus = getFinalRoundBonus(member, round);
      return {
        ...member,
        roundScore,
        hmServerScore,
        extraContribution: getRoundExtraContribution(member, round),
        finalRoundBonus,
        total,
        seventy: getSeventyScore(member, round, total),
      };
    })
    .sort(compareResultMembers)
    .map((member, index, list) => ({
      ...member,
      currentRank: ranks[index] || `순위 ${index + 1}`,
      rankNumber: index + 1,
      gap: index === 0 ? null : list[index - 1].seventy - member.seventy,
    }));
}

function render() {
  renderAuthShell();
  renderTopbar();
  if (isAdmin) {
    renderSetup();
    renderEntry();
    renderHistory();
  }
  renderResult();
  saveState();
}

function renderAuthShell() {
  const isAuthenticated = Boolean(currentUser);
  const requiresPasswordSetup = Boolean(currentUser?.mustChangePassword || currentUser?.passwordResetRequired);
  document.body.classList.toggle("is-authenticated", isAuthenticated);
  document.body.classList.toggle("is-admin", isAdmin);
  document.body.classList.toggle("must-change-password", requiresPasswordSetup);
  $("#currentUserLabel").textContent = currentUser
    ? `${currentUser.displayName || currentUser.username} · ${currentUser.role === "admin" ? "관리자" : "일반"}`
    : "-";

  const currentPasswordField = $("#currentPasswordInput")?.closest(".field");
  const currentPasswordWarning = document.querySelector('[data-caps-warning-for="currentPasswordInput"]');
  if (currentPasswordField) currentPasswordField.hidden = Boolean(currentUser?.passwordResetRequired);
  if (currentPasswordWarning) currentPasswordWarning.hidden = Boolean(currentUser?.passwordResetRequired);

  if (requiresPasswordSetup && !$("#accountView").classList.contains("is-active")) {
    showView("account");
    return;
  }

  if (!isAdmin && !$("#resultView").classList.contains("is-active")) {
    showView("result");
  }
}

function requireAdminAction() {
  if (isAdmin) return true;
  alert("관리자만 사용할 수 있는 기능입니다.");
  return false;
}

function showView(viewName) {
  if (currentUser?.mustChangePassword) {
    viewName = "account";
  }

  const target = $(`#${viewName}View`);
  if (!target || (target.classList.contains("admin-only") && !isAdmin)) {
    viewName = "result";
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${viewName}View`);
  });
}

function renderTopbar() {
  const rounds = getRounds();
  fillSelect(
    $("#seasonSelect"),
    appState.seasons.map((season) => ({ value: season.id, label: season.season })),
    state.id
  );
  $("#memberCountLabel").textContent = `${state.members.length}명`;
  $("#totalScoreLabel").textContent = formatNumber(
    state.members.reduce((sum, member) => sum + getMemberTotal(member), 0)
  );

  fillSelect($("#roundSelect"), rounds, $("#roundSelect").value || rounds.at(-1));
}

function renderSetup() {
  $("#seasonInput").value = state.season;
  $("#roundCountInput").value = state.roundCount;

  const body = $("#memberTableBody");
  body.innerHTML = "";

  if (!state.members.length) {
    body.innerHTML = `<tr><td class="empty" colspan="4">멤버가 없습니다. 멤버를 추가하거나 이전 시즌 멤버를 불러와주세요.</td></tr>`;
    return;
  }

  state.members.forEach((member) => {
    const row = document.createElement("tr");
    row.className = "member-row";
    row.innerHTML = `
      <td data-label="기준 직급">
        <select data-member-id="${member.id}" data-field="baseRank">
          ${ranks.map((rank) => `<option ${rank === member.baseRank ? "selected" : ""}>${rank}</option>`).join("")}
        </select>
      </td>
      <td data-label="이름"><input data-member-id="${member.id}" data-field="name" value="${escapeHtml(member.name)}" /></td>
      <td data-label="기본 기여도"><input class="number" data-member-id="${member.id}" data-field="baseScore" type="number" min="0" value="${member.baseScore || 0}" /></td>
      <td data-label="삭제"><button class="remove-button" data-remove-member="${member.id}">×</button></td>
    `;
    body.appendChild(row);
  });
}

function renderEntry() {
  const rounds = getRounds();
  fillSelect($("#scoreRoundSelect"), rounds, $("#roundSelect").value || rounds.at(-1));

  const selectedRound = $("#scoreRoundSelect").value;
  const selectedRoundResults = getResults(selectedRound);
  const entryBody = $("#roundEntryTableBody");
  entryBody.innerHTML = state.members.length
    ? state.members
        .map((member) => {
          const baseRoundScore = getRoundEntryScore(member, selectedRound);
          const extraContribution = getRoundExtraContribution(member, selectedRound);
          const roundScore = getRoundScore(member, selectedRound);
          return `
            <tr>
              <td data-label="직급">${escapeHtml(member.baseRank)}</td>
              <td data-label="이름">${escapeHtml(member.name)}</td>
              <td class="number" data-label="현재 회차 점수">${formatNumber(roundScore)}</td>
              <td data-label="기본 점수 수정"><input class="number round-total-input" data-edit-member-id="${member.id}" type="number" min="0" value="${baseRoundScore}" /></td>
              <td data-label="추가 기여도"><input class="number extra-contribution-input" data-extra-member-id="${member.id}" type="number" min="0" value="${extraContribution}" /></td>
              <td data-label="기본 점수 입력"><input class="number round-score-input" data-entry-member-id="${member.id}" type="number" min="0" placeholder="기본 점수 덮어쓰기" /></td>
              <td data-label="추가 사유"><input data-entry-reason-id="${member.id}" type="text" placeholder="예: 퇴근 전쟁" /></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td class="empty" colspan="7">멤버를 먼저 등록해주세요.</td></tr>`;

  const preview = $("#entryPreviewBody");
  preview.innerHTML = resultRowsHtml(selectedRoundResults);
}

function renderResult() {
  const results = getResults($("#roundSelect").value);
  const leader = results[0];
  $("#leaderLabel").textContent = leader ? `${leader.name} (${leader.currentRank})` : "-";
  $("#leaderScoreLabel").textContent = leader ? formatNumber(leader.total) : "0";
  $("#leaderSeventyLabel").textContent = leader ? formatNumber(leader.seventy) : "0";
  renderHmStatus($("#roundSelect").value);
  renderEarlyLeaveToggle($("#roundSelect").value);
  renderFinalRoundToggle($("#roundSelect").value);
  $("#resultTableBody").innerHTML = resultRowsHtml(results, true);
  renderMemberDetail();
  $("#textOutput").value = makeTextOutput(results);
}

function renderEarlyLeaveToggle(round) {
  const button = $("#earlyLeaveToggleButton");
  if (!button) return;

  const enabled = isEarlyLeaveRound(round);
  button.classList.toggle("is-active", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  button.textContent = enabled ? "조기퇴근 전체반영 ON" : "조기퇴근 전체반영";
}

function renderFinalRoundToggle(round) {
  const button = $("#finalRoundFullToggleButton");
  if (!button) return;

  const enabled = isFinalRoundFullRound(round);
  button.classList.toggle("is-active", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  button.textContent = enabled ? "마지막 회차 100% ON" : "마지막 회차 100%";
}

function renderHmStatus(round) {
  const status = $("#hmSyncStatus");
  if (!status) return;

  const earlyLeaveText = isEarlyLeaveRound(round) ? " / 조기 퇴근 데이: 방송 끝까지 반영" : "";
  const updatedAt = state.hmServerMeta?.updatedAt;
  if (!updatedAt) {
    status.textContent = `HM 서버 점수는 퇴근전쟁이 끝난 이후 갱신 됩니다.${earlyLeaveText}`;
    return;
  }

  const window = state.hmServerMeta?.roundWindows?.[round];
  if (!window) {
    status.textContent = `HM 서버 점수는 퇴근전쟁이 끝난 이후 갱신 됩니다.${earlyLeaveText} 최근 갱신: ${updatedAt} / ${state.season} ${round} 데이터 없음`;
    return;
  }

  const windowText = window ? ` / ${round} 기준 ${window.start} ~ ${window.end}` : "";
  status.textContent = `HM 서버 점수는 퇴근전쟁이 끝난 이후 갱신 됩니다.${earlyLeaveText} 최근 갱신: ${updatedAt}${windowText}`;
}

function renderMemberDetail() {
  const select = $("#memberDetailSelect");
  const orderedMembers = getResults($("#roundSelect").value);
  fillSelect(
    select,
    orderedMembers.map((member) => ({ value: member.id, label: `${member.rankNumber}. ${member.name}` })),
    select.value || orderedMembers[0]?.id
  );

  const member = orderedMembers.find((item) => item.id === select.value) || orderedMembers[0];
  const body = $("#memberDetailBody");

  if (!member) {
    body.innerHTML = `<tr><td class="empty" colspan="8">멤버를 먼저 등록해주세요.</td></tr>`;
    return;
  }

  body.innerHTML = getRounds()
    .map((round) => {
      const roundEntries = state.entries.filter((entry) => entry.memberId === member.id && entry.round === round);
      const reason = roundEntries.map((entry) => entry.reason).filter(Boolean).join(", ");
      const total = getMemberTotal(member, round);
      const roundScore = getRoundScore(member, round);
      const hmServerScore = getHmServerScore(member, round);
      const extraContribution = getRoundExtraContribution(member, round);
      const finalRoundBonus = getFinalRoundBonus(member, round);
      const seventy = getSeventyScore(member, round, total);
      return `
        <tr>
          <td data-label="회차">${escapeHtml(round)}</td>
          <td class="number" data-label="회차 점수">${formatNumber(roundScore)}</td>
          <td class="number" data-label="HM 서버 점수">${hmServerScore === null ? "-" : formatNumber(hmServerScore)}</td>
          <td class="number" data-label="누적 기여도">${formatNumber(total)}</td>
          <td class="number" data-label="기여도 70%">${formatNumber(seventy)}</td>
          <td class="number" data-label="마지막 회차 가산">${formatNumber(finalRoundBonus)}</td>
          <td class="number" data-label="추가 기여도">${extraContribution === null ? "-" : formatNumber(extraContribution)}</td>
          <td data-label="사유">${escapeHtml(reason)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderHistory() {
  const body = $("#historyTableBody");
  const entries = [...state.entries].reverse();
  body.innerHTML = entries.length
    ? entries
        .map((entry) => {
          const member = state.members.find((item) => item.id === entry.memberId);
          return `
            <tr>
              <td data-label="시간">${escapeHtml(entry.createdAt || "")}</td>
              <td data-label="회차">${escapeHtml(entry.round)}</td>
              <td data-label="이름">${escapeHtml(member?.name || "삭제된 멤버")}</td>
              <td class="number" data-label="점수">${formatNumber(entry.score)}</td>
              <td data-label="사유">${escapeHtml(entry.reason || "")}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td class="empty" colspan="5">아직 입력 기록이 없습니다.</td></tr>`;
}

function renderUsers(users = []) {
  const body = $("#usersTableBody");
  body.innerHTML = users.length
    ? users
        .map((user) => {
          const isCurrentUser = user.username === currentUser?.username;
          const isProtectedBootstrap = Boolean(user.isBootstrapAdmin);
          const disableDelete = isCurrentUser || isProtectedBootstrap;
          const disableReset = isCurrentUser || isProtectedBootstrap;
          const roleLabel = `${user.role === "admin" ? "관리자" : "일반"}${user.passwordResetRequired ? " · 리셋 대기" : ""}`;
          return `
          <tr>
            <td data-label="아이디">${escapeHtml(user.username)}</td>
            <td data-label="이름">${escapeHtml(user.displayName || "")}</td>
            <td data-label="권한">${escapeHtml(roleLabel)}</td>
            <td data-label="생성일">${escapeHtml(formatLogDate(user.createdAt))}</td>
            <td data-label="관리">
              <div class="row-actions">
                <button class="small-button" data-reset-user="${escapeHtml(user.username)}" ${disableReset ? "disabled" : ""}>암호 리셋</button>
                <button class="small-button danger-small" data-delete-user="${escapeHtml(user.username)}" ${disableDelete ? "disabled" : ""}>삭제</button>
              </div>
            </td>
          </tr>
        `;
        })
        .join("")
    : `<tr><td class="empty" colspan="5">등록된 사용자가 없습니다.</td></tr>`;
}

function renderAccessLogs(logs = []) {
  const body = $("#accessLogBody");
  body.innerHTML = logs.length
    ? logs
        .map((log) => `
          <tr>
            <td data-label="시간">${escapeHtml(formatLogDate(log.at))}</td>
            <td data-label="아이디">${escapeHtml(log.username)}</td>
            <td data-label="이름">${escapeHtml(log.displayName || "")}</td>
            <td data-label="동작">${escapeHtml(formatAction(log.action))}</td>
            <td data-label="상세">${escapeHtml(log.detail || "")}</td>
            <td data-label="IP">${escapeHtml(log.ip || "")}</td>
          </tr>
        `)
        .join("")
    : `<tr><td class="empty" colspan="6">아직 활동 로그가 없습니다.</td></tr>`;
}

function renderStateBackups(backups = []) {
  const body = $("#backupTableBody");
  if (!body) return;

  body.innerHTML = backups.length
    ? backups
        .map((backup) => {
          const seasons = backup.summary?.seasons || [];
          const detail = seasons
            .map((season) => `${season.season || season.id} · ${season.members || 0}명 · ${season.entries || 0}건`)
            .join(" / ");
          return `
          <tr>
            <td data-label="시간">${escapeHtml(formatLogDate(backup.at))}</td>
            <td data-label="작업자">${escapeHtml(backup.username || "")}</td>
            <td data-label="사유">${escapeHtml(backup.reason || "")}</td>
            <td data-label="내용">${escapeHtml(detail || "-")}</td>
            <td data-label="복구">
              <button class="small-button" data-restore-backup="${escapeHtml(backup.id)}">복구</button>
            </td>
          </tr>
        `;
        })
        .join("")
    : `<tr><td class="empty" colspan="5">아직 자동 백업이 없습니다.</td></tr>`;
}

function formatAction(action) {
  const labels = {
    login: "로그인",
    logout: "로그아웃",
    click_tab: "메뉴 클릭",
    click_result_category: "결과 보기 클릭",
    change_season: "시즌 변경",
    save_season_setup: "시즌 설정 저장",
    add_season: "새 시즌 추가",
    delete_season: "시즌 삭제",
    import_members: "이전 시즌 멤버 불러오기",
    add_member: "멤버 추가",
    remove_member: "멤버 삭제",
    change_round: "회차 변경",
    change_score_input_round: "입력 회차 변경",
    view_member_detail: "멤버별 보기",
    apply_round_scores: "점수 반영",
    edit_round_scores: "회차 점수 수정",
    sync_hm_scores: "HM 점수 반영",
    copy_result_text: "텍스트 복사",
    refresh_hm_server: "HM 서버 갱신",
    toggle_final_round_full: "마지막 회차 100% 반영",
    download_excel: "엑셀 다운로드",
    download_backup: "백업 다운로드",
    load_sample: "샘플 불러오기",
    reset_all: "전체 초기화",
    create_user: "사용자 추가",
    create_user_preview: "사용자 추가",
    delete_user: "사용자 삭제",
    reset_user_password: "암호 리셋",
    change_password: "비밀번호 변경",
    restore_state: "백업 복구",
  };
  return labels[action] || action || "";
}

function formatLogDate(value) {
  if (!value) return "";
  if (value === "환경변수") return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

function resultRowsHtml(results, includeBaseRank = false) {
  if (!results.length) {
    return `<tr><td class="empty" colspan="${includeBaseRank ? 11 : 10}">멤버를 먼저 등록해주세요.</td></tr>`;
  }

  const rows = results
    .map((member) => {
      const rankClass =
        member.rankNumber === 1
          ? "leader rank-first"
          : member.rankNumber === 2
            ? "rank-second"
            : member.rankNumber === 3
              ? "rank-third"
              : member.rankNumber <= 6
                ? "rank-mid"
                : "rank-lower";

      return `
      <tr class="${rankClass}">
        <td class="rank" data-label="순위">${member.rankNumber}</td>
        <td data-label="현재 직급">${escapeHtml(member.currentRank)}</td>
        ${includeBaseRank ? `<td data-label="기준 직급">${escapeHtml(member.baseRank)}</td>` : ""}
        <td data-label="이름">${escapeHtml(member.name)}</td>
        <td class="number" data-label="선택 회차">${formatNumber(member.roundScore)}</td>
        <td class="number hm-score" data-label="HM 서버">${member.hmServerScore === null ? "-" : formatNumber(member.hmServerScore)}</td>
        <td class="number" data-label="누적 100%">${formatNumber(member.total)}</td>
        <td class="number" data-label="70% 기준">${formatNumber(member.seventy)}</td>
        <td class="number final-round-bonus" data-label="마지막 회차 가산">${formatNumber(member.finalRoundBonus)}</td>
        <td class="number extra-score" data-label="추가 기여도">${member.extraContribution === null ? "-" : formatNumber(member.extraContribution)}</td>
        <td class="number" data-label="위 70% 차이">${member.gap === null ? "-" : formatNumber(member.gap)}</td>
      </tr>
    `;
    })
    .join("");
  return `${rows}${resultTotalRowHtml(results, includeBaseRank)}`;
}

function resultTotalRowHtml(results, includeBaseRank = false) {
  const totals = results.reduce(
    (sum, member) => ({
      roundScore: sum.roundScore + Number(member.roundScore || 0),
      hmServerScore: sum.hmServerScore + Number(member.hmServerScore || 0),
      hmCount: sum.hmCount + (member.hmServerScore === null ? 0 : 1),
      total: sum.total + Number(member.total || 0),
      seventy: sum.seventy + Number(member.seventy || 0),
      finalRoundBonus: sum.finalRoundBonus + Number(member.finalRoundBonus || 0),
      extraContribution: sum.extraContribution + Number(member.extraContribution || 0),
    }),
    { roundScore: 0, hmServerScore: 0, hmCount: 0, total: 0, seventy: 0, finalRoundBonus: 0, extraContribution: 0 }
  );

  const spacerLabels = includeBaseRank ? ["현재 직급", "기준 직급", "이름"] : ["직급", "이름"];
  const leadingSpacers = spacerLabels
    .map((label) => `<td class="total-spacer" data-label="${label}"></td>`)
    .join("");

  return `
    <tr class="result-total-row">
      <td class="total-label" data-label="합계">선택회차 점수 총합</td>
      ${leadingSpacers}
      <td class="number total-value" data-label="선택 회차">${formatNumber(totals.roundScore)}</td>
      <td class="number total-value hm-score" data-label="HM 서버">${totals.hmCount ? formatNumber(totals.hmServerScore) : "-"}</td>
      <td class="number total-value" data-label="누적 100%">${formatNumber(totals.total)}</td>
      <td class="number total-value" data-label="70% 기준">${formatNumber(totals.seventy)}</td>
      <td class="number total-value final-round-bonus" data-label="마지막 회차 가산">${formatNumber(totals.finalRoundBonus)}</td>
      <td class="number total-value extra-score" data-label="추가 기여도">${formatNumber(totals.extraContribution)}</td>
      <td class="number total-value" data-label="위 70% 차이">-</td>
    </tr>
  `;
}

function makeTextOutput(results) {
  const round = $("#roundSelect").value || getRounds().at(-1);
  const lines = [`[${state.season} ${round} 기여도]`];
  results.forEach((member) => {
    const gap = member.gap === null ? "-" : formatNumber(member.gap);
    const hmScore = member.hmServerScore === null ? "-" : formatNumber(member.hmServerScore);
    const extraContribution = member.extraContribution === null ? "-" : formatNumber(member.extraContribution);
    lines.push(
      `${member.rankNumber}. ${member.currentRank} ${member.name} / 회차 ${formatNumber(member.roundScore)} / HM ${hmScore} / 누적 ${formatNumber(member.total)} / 70% ${formatNumber(member.seventy)} / 마지막가산 ${formatNumber(member.finalRoundBonus)} / 추가 ${extraContribution} / 70%차이 ${gap}`
    );
  });
  return lines.join("\n");
}

function parseHmDate(value) {
  const text = String(value ?? "");
  const match = text.match(/Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
  if (match) {
    const [, year, month, date, hour, minute, second] = match.map(Number);
    if (year < 2020) return null;
    return new Date(year, month, date, hour, minute, second);
  }

  const parsed = new Date(text.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 2020) return null;
  return parsed;
}

function formatDateTime(date) {
  if (!date) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getHmScoreValue(row) {
  const total = Number(row?.[7]);
  if (Number.isFinite(total)) return total;
  const score = Number(String(row?.[2] ?? "").replace(/[^0-9-]/g, ""));
  return Number.isFinite(score) ? score : 0;
}

function buildHmServerScores(rows) {
  const scores = {};
  const roundWindows = {};
  const memberByHmName = new Map(state.members.map((member) => [normalizeHmName(getHmMemberName(member)), member]));

  getRounds().forEach((round) => {
    const hmRound = `엑셀부${getRoundIndex(round)}회차`;
    const roundRows = rows.filter((row) => {
      const cells = Array.isArray(row) ? row : [];
      const roundNameCell = String(cells[8] ?? "").trim();
      return roundNameCell === hmRound;
    });
    const datedRows = roundRows
      .map((row) => ({ row, date: parseHmDate(row?.[0]) }))
      .filter((item) => item.date)
      .sort((a, b) => a.date - b.date);

    if (!datedRows.length) return;

    scores[round] = Object.fromEntries(state.members.map((member) => [member.id, 0]));
    const start = datedRows[0].date;
    const isFullRound = isEarlyLeaveRound(round);
    const end = isFullRound ? datedRows.at(-1).date : new Date(start);
    if (!isFullRound) {
      end.setDate(end.getDate() + 1);
      end.setHours(2, 1, 0, 0);
    }
    roundWindows[round] = {
      start: formatDateTime(start),
      end: formatDateTime(end),
      mode: isFullRound ? "early_leave_full" : "cutoff_0201",
    };

    datedRows.forEach(({ row, date }) => {
      if (date < start || (!isFullRound && date >= end)) return;
      const member = memberByHmName.get(normalizeHmName(row?.[4]));
      if (!member) return;
      scores[round][member.id] += getHmScoreValue(row);
    });
  });

  return { scores, roundWindows };
}

function getMaxHmRoundIndex(rows) {
  return (rows || []).reduce((maxRound, row) => {
    const roundNameCell = String(Array.isArray(row) ? row[8] ?? "" : "").trim();
    const match = roundNameCell.match(/^엑셀부(\d+)회차$/);
    return match ? Math.max(maxRound, Number(match[1])) : maxRound;
  }, 0);
}

function getSeasonNumber(name) {
  const match = String(name || "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function shouldIgnoreBaseScore(seasonName) {
  const seasonNumber = getSeasonNumber(seasonName);
  return seasonNumber !== null && seasonNumber >= 6;
}

function getHmApiUrlForSeason() {
  const seasonNumber = getSeasonNumber(state.season);
  const apiPath = hmSeasonApiPaths[seasonNumber];
  if (!apiPath) {
    throw new Error(`${state.season}에 연결된 HM 서버 경로가 없습니다.`);
  }
  return `${hmApiBaseUrl}/${apiPath}`;
}

async function refreshHmServerScores() {
  const button = $("#refreshHmButton");
  const status = $("#hmSyncStatus");
  if (button) {
    button.disabled = true;
    button.textContent = "갱신 중";
  }
  if (status) status.textContent = "HM 서버 점수를 가져오는 중입니다...";

  try {
    const hmApiUrl = getHmApiUrlForSeason();
    const response = await fetch(hmApiUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    const hmRows = Array.isArray(rows) ? rows : [];
    const maxHmRound = getMaxHmRoundIndex(hmRows);
    if (maxHmRound > Number(state.roundCount || 0)) {
      state.roundCount = maxHmRound;
    }
    const { scores, roundWindows } = buildHmServerScores(hmRows);
    state.hmServerScores = scores;
    state.hmServerMeta = {
      updatedAt: new Date().toLocaleString("ko-KR"),
      source: hmApiUrl,
      roundWindows,
    };
    render();
  } catch (error) {
    console.error("HM 서버 점수 갱신 실패:", error);
    if (status) status.textContent = "HM 서버 점수를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.";
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "HM 서버 갱신";
    }
  }
}

function fillSelect(select, values, selectedValue) {
  const options = values.map((item) => {
    const value = typeof item === "string" ? item : item.value;
    const label = typeof item === "string" ? item : item.label;
    return `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
  });
  select.innerHTML = options.join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#logoutButton").addEventListener("click", handleLogout);
  $("#createUserForm").addEventListener("submit", handleCreateUser);
  $("#usersTableBody").addEventListener("click", handleUserManagementClick);
  $("#refreshUsersButton").addEventListener("click", loadAdminData);
  $("#refreshBackupsButton").addEventListener("click", loadStateBackups);
  $("#backupTableBody").addEventListener("click", handleBackupRestoreClick);
  $("#changePasswordForm").addEventListener("submit", handleChangePassword);
  bindPasswordInputs();

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.view);
      logClientAction("click_tab", button.textContent.trim());
      if (button.dataset.view === "users") loadAdminData();
      if (button.dataset.view === "history") loadStateBackups();
    });
  });

  document.querySelectorAll(".result-category").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".result-category").forEach((category) => category.classList.remove("is-active"));
      document.querySelectorAll(".result-panel").forEach((panel) => panel.classList.remove("is-active"));
      button.classList.add("is-active");
      $(`#${button.dataset.resultPanel}ResultPanel`).classList.add("is-active");
      logClientAction("click_result_category", button.textContent.trim());
    });
  });

  $("#seasonSelect").addEventListener("change", (event) => {
    setCurrentSeason(event.target.value);
    logClientAction("change_season", state.season);
    render();
  });

  $("#saveSetupButton").addEventListener("click", () => {
    const previousSeasonId = state.id;
    state.season = $("#seasonInput").value.trim() || "새 시즌";
    state.roundCount = Math.max(1, Math.min(30, Number($("#roundCountInput").value) || 1));
    appState.seasons = sortSeasonsByLatest(appState.seasons);
    setCurrentSeason(previousSeasonId);
    logClientAction("save_season_setup", state.season);
    render();
  });

  $("#addSeasonButton").addEventListener("click", () => {
    const copyMembers = Boolean(state.members.length) && confirm("이전 시즌 멤버/직급을 복사해서 새 시즌을 만들까요? 취소하면 빈 시즌으로 시작합니다.");
    const season = addSeason({ copyMembers });
    logClientAction("add_season", `${season.season}${copyMembers ? " 멤버 복사" : " 빈 시즌"}`);
    render();
  });

  $("#deleteSeasonButton").addEventListener("click", () => {
    if (appState.seasons.length <= 1) {
      alert("시즌은 최소 1개가 필요해서 마지막 시즌은 삭제할 수 없습니다.");
      return;
    }

    const seasonName = state.season;
    if (!confirm(`${seasonName} 시즌을 삭제할까요? 이 시즌의 멤버, 점수, HM 서버 점수가 모두 삭제됩니다.`)) return;

    const deletedSeason = deleteCurrentSeason();
    if (!deletedSeason) return;
    logClientAction("delete_season", deletedSeason.season);
    render();
  });

  $("#importMembersButton").addEventListener("click", () => {
    const sourceSeason = getPreviousSeasonForCurrent();
    if (!sourceSeason) {
      alert("불러올 이전 시즌 멤버가 없습니다.");
      return;
    }

    if (state.members.length && !confirm("현재 시즌의 멤버 목록을 이전 시즌 멤버로 바꿀까요? 기존 멤버와 점수는 초기화됩니다.")) return;

    const importedSeason = importMembersFromPreviousSeason();
    if (!importedSeason) return;
    logClientAction("import_members", `${importedSeason.season} -> ${state.season}`);
    render();
  });

  $("#addMemberButton").addEventListener("click", () => {
    state.members.push({ id: crypto.randomUUID(), baseRank: "신입", name: "새 멤버", baseScore: 0 });
    logClientAction("add_member", state.season);
    render();
  });

  $("#memberTableBody").addEventListener("input", updateMemberFromEvent);
  $("#memberTableBody").addEventListener("change", updateMemberFromEvent);
  $("#memberTableBody").addEventListener("click", (event) => {
    const id = event.target.dataset.removeMember;
    if (!id) return;
    state.members = state.members.filter((member) => member.id !== id);
    state.entries = state.entries.filter((entry) => entry.memberId !== id);
    Object.values(state.extraContributions || {}).forEach((roundScores) => {
      delete roundScores[id];
    });
    logClientAction("remove_member", state.season);
    render();
  });

  $("#roundSelect").addEventListener("change", () => {
    logClientAction("change_round", `${state.season} ${$("#roundSelect").value}`);
    render();
  });
  $("#scoreRoundSelect").addEventListener("change", () => {
    logClientAction("change_score_input_round", `${state.season} ${$("#scoreRoundSelect").value}`);
    renderEntry();
  });
  $("#memberDetailSelect").addEventListener("change", () => {
    const member = state.members.find((item) => item.id === $("#memberDetailSelect").value);
    logClientAction("view_member_detail", member?.name || "");
    renderMemberDetail();
  });

  $("#applyRoundButton").addEventListener("click", () => {
    const round = $("#scoreRoundSelect").value;
    const rows = [...document.querySelectorAll("#roundEntryTableBody tr")];
    let changedCount = 0;

    rows.forEach((row) => {
      const scoreInput = row.querySelector("[data-entry-member-id]");
      if (!scoreInput) return;

      const memberId = scoreInput.dataset.entryMemberId;
      const rawScore = scoreInput.value.trim();
      if (!memberId || rawScore === "") return;

      const score = Number(rawScore);
      if (!Number.isFinite(score) || score < 0) return;

      const currentScore = getRoundEntryScore({ id: memberId }, round);
      if (currentScore === score) return;

      const reason = row.querySelector(`[data-entry-reason-id="${memberId}"]`)?.value.trim() || "회차 점수 입력";
      state.entries = state.entries.filter((entry) => !(entry.memberId === memberId && entry.round === round));

      if (score > 0) {
        state.entries.push({
          id: crypto.randomUUID(),
          memberId,
          round,
          score,
          reason,
          createdAt: new Date().toLocaleString("ko-KR"),
        });
      }
      changedCount += 1;
    });

    if (!changedCount) return;
    logClientAction("apply_round_scores", `${state.season} ${round} ${changedCount}건`);
    render();
  });

  $("#saveRoundEditsButton").addEventListener("click", () => {
    const round = $("#scoreRoundSelect").value;
    const rows = [...document.querySelectorAll("#roundEntryTableBody tr")];
    let changedCount = 0;

    rows.forEach((row) => {
      const totalInput = row.querySelector("[data-edit-member-id]");
      if (!totalInput) return;

      const memberId = totalInput.dataset.editMemberId;
      const memberRef = { id: memberId };
      const currentScore = getRoundEntryScore(memberRef, round);
      const currentExtra = getRoundExtraContribution(memberRef, round);
      const nextScore = Number(totalInput.value) || 0;
      const nextExtra = Number(row.querySelector(`[data-extra-member-id="${memberId}"]`)?.value) || 0;
      const reason = row.querySelector(`[data-entry-reason-id="${memberId}"]`)?.value.trim() || "회차 점수 수정";
      if (!memberId || (currentScore === nextScore && currentExtra === nextExtra)) return;

      state.entries = state.entries.filter((entry) => !(entry.memberId === memberId && entry.round === round));
      if (nextScore > 0) {
        state.entries.push({
          id: crypto.randomUUID(),
          memberId,
          round,
          score: nextScore,
          reason,
          createdAt: new Date().toLocaleString("ko-KR"),
        });
      }
      setRoundExtraContribution(memberId, round, nextExtra);
      changedCount += 1;
    });

    if (!changedCount) return;
    logClientAction("edit_round_scores", `${state.season} ${round} ${changedCount}건`);
    render();
  });

  $("#copyTextButton").addEventListener("click", async () => {
    const output = $("#textOutput");
    output.select();
    try {
      await navigator.clipboard.writeText(output.value);
    } catch {
      document.execCommand("copy");
    }
    logClientAction("copy_result_text", `${state.season} ${$("#roundSelect").value}`);
  });

  $("#refreshHmButton").addEventListener("click", () => {
    if (!requireAdminAction()) return;
    logClientAction("refresh_hm_server", state.season);
    refreshHmServerScores();
  });
  $("#earlyLeaveToggleButton").addEventListener("click", () => {
    if (!requireAdminAction()) return;
    const round = $("#roundSelect").value || getRounds().at(-1);
    const enabled = !isEarlyLeaveRound(round);
    setEarlyLeaveRound(round, enabled);
    logClientAction("toggle_early_leave_round", `${state.season} ${round} ${enabled ? "on" : "off"}`);
    render();
    refreshHmServerScores();
  });
  $("#finalRoundFullToggleButton").addEventListener("click", () => {
    if (!requireAdminAction()) return;
    const round = $("#roundSelect").value || getRounds().at(-1);
    const enabled = !isFinalRoundFullRound(round);
    setFinalRoundFullRound(round, enabled);
    logClientAction("toggle_final_round_full", `${state.season} ${round} ${enabled ? "on" : "off"}`);
    render();
  });
  $("#syncHmScoresButton").addEventListener("click", () => {
    if (!requireAdminAction()) return;
    const round = $("#roundSelect").value || getRounds().at(-1);
    if (!hasHmScoresForRound(round)) {
      alert(`${state.season} ${round} HM 서버 점수가 아직 없습니다. HM 서버에 해당 시즌 데이터가 올라온 뒤 갱신해주세요.`);
      return;
    }

    if (!confirm(`${round} 기본 점수를 HM 서버 점수로 맞출까요? 추가 기여도는 그대로 유지됩니다.`)) return;

    let changedCount = 0;
    state.members.forEach((member) => {
      const hmServerScore = getHmServerScore(member, round);
      if (hmServerScore === null) return;

      const currentScore = getRoundEntryScore(member, round);
      if (currentScore === hmServerScore) return;

      state.entries = state.entries.filter((entry) => !(entry.memberId === member.id && entry.round === round));
      if (hmServerScore > 0) {
        state.entries.push({
          id: crypto.randomUUID(),
          memberId: member.id,
          round,
          score: hmServerScore,
          reason: "HM 서버 점수 반영",
          createdAt: new Date().toLocaleString("ko-KR"),
        });
      }
      changedCount += 1;
    });

    if (!changedCount) return;
    logClientAction("sync_hm_scores", `${state.season} ${round} ${changedCount}건`);
    render();
  });
  $("#downloadExcelButton").addEventListener("click", () => {
    logClientAction("download_excel", `${state.season} ${$("#roundSelect").value}`);
    downloadExcel();
  });
  $("#downloadJsonButton").addEventListener("click", () => {
    logClientAction("download_backup", state.season);
    downloadFile(`${state.season}_backup.json`, JSON.stringify(state, null, 2), "application/json");
  });

  $("#saveSampleButton").addEventListener("click", () => {
    appState = structuredClone(sampleState);
    state = getCurrentSeason();
    logClientAction("load_sample", state.season);
    render();
  });

  $("#resetButton").addEventListener("click", () => {
    if (!confirm("전체 데이터를 초기화할까요?")) return;
    appState = {
      dataVersion: sampleState.dataVersion,
      currentSeasonId: "new-season",
      seasons: [normalizeSeason({ id: "new-season", season: "새 시즌", roundCount: 7, members: [], entries: [] })],
    };
    state = getCurrentSeason();
    logClientAction("reset_all", "전체 데이터 초기화");
    render();
  });
}

function bindPasswordInputs() {
  document.querySelectorAll(".password-input").forEach((input) => {
    input.addEventListener("beforeinput", (event) => {
      if (!event.data) return;
      if (/[^A-Za-z0-9]/.test(event.data)) {
        event.preventDefault();
      }
    });
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^A-Za-z0-9]/g, "");
    });
    input.addEventListener("keydown", updateCapsWarning);
    input.addEventListener("keyup", updateCapsWarning);
    input.addEventListener("focus", updateCapsWarning);
    input.addEventListener("blur", () => setCapsWarning(input, false));
  });
}

function updateCapsWarning(event) {
  const isCapsOn = Boolean(event.getModifierState?.("CapsLock"));
  setCapsWarning(event.currentTarget, isCapsOn);
}

function setCapsWarning(input, isVisible) {
  const warning = document.querySelector(`[data-caps-warning-for="${input.id}"]`);
  if (warning) warning.classList.toggle("is-visible", isVisible);
}

function updateMemberFromEvent(event) {
  const id = event.target.dataset.memberId;
  const field = event.target.dataset.field;
  if (!id || !field) return;

  const member = state.members.find((item) => item.id === id);
  if (!member) return;
  member[field] = field === "baseScore" ? Number(event.target.value) || 0 : event.target.value;
  saveState();
  renderTopbar();
  renderResult();
}

function downloadExcel() {
  const round = $("#roundSelect").value || getRounds().at(-1);
  const results = getResults(round);
  const rows = [
    ["순위", "현재 직급", "기준 직급", "이름", "선택 회차 점수", "HM 서버 점수", "누적 기여도 100%", "기여도 70%", "마지막 회차 가산", "추가 기여도", "위 70% 차이"],
    ...results.map((member) => [
      member.rankNumber,
      member.currentRank,
      member.baseRank,
      member.name,
      member.roundScore,
      member.hmServerScore === null ? "-" : member.hmServerScore,
      member.total,
      member.seventy,
      member.finalRoundBonus,
      member.extraContribution === null ? "-" : member.extraContribution,
      member.gap === null ? "-" : member.gap,
    ]),
  ];

  const table = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const html = `
    <html>
      <head><meta charset="UTF-8" /></head>
      <body>
        <h2>${escapeHtml(state.season)} ${escapeHtml(round)} 기여도</h2>
        <table border="1">${table}</table>
      </body>
    </html>
  `;

  downloadFile(`${state.season}_${round}_기여도.xls`, html, "application/vnd.ms-excel;charset=utf-8");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function isLocalPreview() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function getLocalUsers() {
  const saved = JSON.parse(localStorage.getItem("seasonContributionLocalUsers") || "null");
  if (Array.isArray(saved) && saved.length) return saved;

  const users = [];
  localStorage.setItem("seasonContributionLocalUsers", JSON.stringify(users));
  return users;
}

function saveLocalUsers(users) {
  localStorage.setItem("seasonContributionLocalUsers", JSON.stringify(users));
}

function cleanLocalUser(user) {
  if (!user) return null;
  const { password, ...publicUser } = user;
  return publicUser;
}

function isValidPasswordText(password) {
  return passwordPattern.test(String(password || ""));
}

function getFailedLoginCount() {
  return Number(sessionStorage.getItem(failedLoginCountKey) || 0);
}

function clearFailedLoginCount() {
  sessionStorage.removeItem(failedLoginCountKey);
  sessionStorage.removeItem(failedLoginRedirectKey);
  localStorage.removeItem(failedLoginRedirectKey);
}

function wasRedirectedAfterFailedLogin() {
  return (
    sessionStorage.getItem(failedLoginRedirectKey) === "1" ||
    localStorage.getItem(failedLoginRedirectKey) === "1"
  );
}

function resetLoginAfterRedirect() {
  if (!wasRedirectedAfterFailedLogin()) return;

  clearFailedLoginCount();
  sessionStorage.removeItem("seasonContributionUser");
  setCurrentUser(null);
  $("#loginUsernameInput").value = "";
  $("#loginPasswordInput").value = "";
  $("#loginMessage").textContent = "";
  render();
}

function registerFailedLogin(messageElement) {
  const failedCount = getFailedLoginCount() + 1;
  sessionStorage.setItem(failedLoginCountKey, String(failedCount));

  if (failedCount >= failedLoginLimit) {
    sessionStorage.setItem(failedLoginRedirectKey, "1");
    localStorage.setItem(failedLoginRedirectKey, "1");
    sessionStorage.removeItem(failedLoginCountKey);
    sessionStorage.removeItem("seasonContributionUser");
    setCurrentUser(null);
    messageElement.textContent = "";
    window.location.href = failedLoginRedirectUrl;
    return;
  }

  messageElement.textContent = `아이디 또는 비밀번호를 확인해주세요. (${failedCount}/${failedLoginLimit})`;
}

function authenticateLocalUser(username, password) {
  const normalized = String(username || "").trim().toLowerCase();
  const user = getLocalUsers().find((item) => item.username === normalized);
  if (user?.passwordResetRequired && !password) return cleanLocalUser(user);
  return user && user.password === password ? cleanLocalUser(user) : null;
}

function createLocalUser({ username, displayName, password, role }) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(normalized)) {
    throw new Error("아이디는 영문/숫자/._- 조합 3자 이상이어야 합니다.");
  }
  if (!password || String(password).length < 6) {
    throw new Error("비밀번호는 6자 이상이어야 합니다.");
  }
  if (!isValidPasswordText(password)) {
    throw new Error("비밀번호는 영문과 숫자만 사용할 수 있습니다.");
  }

  const users = getLocalUsers();
  if (users.some((user) => user.username === normalized)) {
    throw new Error("이미 존재하는 아이디입니다.");
  }

  const user = {
    username: normalized,
    displayName: String(displayName || normalized).trim(),
    role: role === "admin" ? "admin" : "user",
    password,
    createdAt: new Date().toISOString(),
    mustChangePassword: true,
  };
  users.push(user);
  saveLocalUsers(users);
  return cleanLocalUser(user);
}

function deleteLocalUser(username) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) throw new Error("삭제할 사용자를 선택해주세요.");
  if (normalized === currentUser?.username) throw new Error("현재 로그인한 계정은 삭제할 수 없습니다.");

  const users = getLocalUsers();
  const user = users.find((item) => item.username === normalized);
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");

  saveLocalUsers(users.filter((item) => item.username !== normalized));
  return cleanLocalUser(user);
}

function requestLocalUserPasswordReset(username) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) throw new Error("암호 리셋할 사용자를 선택해주세요.");
  if (normalized === currentUser?.username) throw new Error("현재 로그인한 계정은 내 계정에서 비밀번호를 변경해주세요.");

  const users = getLocalUsers();
  const user = users.find((item) => item.username === normalized);
  if (!user) throw new Error("사용자를 찾을 수 없습니다.");

  user.password = crypto.randomUUID();
  user.mustChangePassword = true;
  user.passwordResetRequired = true;
  user.updatedAt = new Date().toISOString();
  saveLocalUsers(users);
  return { user: cleanLocalUser(user) };
}

function updateLocalPassword(username, currentPassword, newPassword) {
  const normalized = String(username || "").trim().toLowerCase();
  const users = getLocalUsers();
  const user = users.find((item) => item.username === normalized);
  if (!user || (!user.passwordResetRequired && user.password !== currentPassword)) {
    throw new Error("현재 비밀번호를 확인해주세요.");
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new Error("새 비밀번호는 6자 이상으로 입력해주세요.");
  }
  if (!isValidPasswordText(newPassword)) {
    throw new Error("비밀번호는 영문과 숫자만 사용할 수 있습니다.");
  }
  user.password = newPassword;
  user.mustChangePassword = false;
  user.passwordResetRequired = false;
  user.updatedAt = new Date().toISOString();
  saveLocalUsers(users);
  return cleanLocalUser(user);
}

function setCurrentUser(user) {
  currentUser = user;
  isAdmin = user?.role === "admin";
}

async function checkSession() {
  if (isLocalPreview()) {
    const savedUser = sessionStorage.getItem("seasonContributionUser");
    setCurrentUser(savedUser ? JSON.parse(savedUser) : null);
    serverStateLoaded = true;
    return;
  }

  try {
    const response = await fetch("/api/session", { credentials: "include" });
    const data = response.ok ? await response.json() : {};
    setCurrentUser(data.authenticated ? data.user : null);
    await loadServerState();
  } catch {
    setCurrentUser(null);
    serverStateLoaded = true;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = $("#loginUsernameInput").value.trim();
  const password = $("#loginPasswordInput").value;
  const message = $("#loginMessage");
  message.textContent = "";

  if (wasRedirectedAfterFailedLogin()) {
    clearFailedLoginCount();
  }

  if (password && !isValidPasswordText(password)) {
    message.textContent = "비밀번호는 영문과 숫자만 입력해주세요.";
    return;
  }

  if (!username) {
    message.textContent = "아이디를 입력해주세요.";
    return;
  }

  if (isLocalPreview()) {
    const user = authenticateLocalUser(username, password);
    if (!user) {
      registerFailedLogin(message);
      return;
    }
    clearFailedLoginCount();
    sessionStorage.setItem("seasonContributionUser", JSON.stringify(user));
    setCurrentUser(user);
    logClientAction("login", "로컬 미리보기");
    render();
    return;
  }

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        message.textContent = data.error || "로그인 실패 횟수가 많습니다. 잠시 후 다시 시도해주세요.";
        return;
      }

      registerFailedLogin(message);
      return;
    }

    const data = await response.json();
    clearFailedLoginCount();
    setCurrentUser(data.user);
    await loadServerState();
    showView(data.user?.mustChangePassword || data.user?.passwordResetRequired ? "account" : "result");
    render();
  } catch {
    message.textContent = "로그인 처리 중 문제가 생겼습니다.";
  }
}

async function handleLogout() {
  if (isLocalPreview()) {
    logClientAction("logout", "로컬 미리보기");
    sessionStorage.removeItem("seasonContributionUser");
  } else {
    await fetch("/api/logout", { method: "POST", credentials: "include" }).catch(() => {});
  }
  setCurrentUser(null);
  showView("result");
  render();
}

async function handleCreateUser(event) {
  event.preventDefault();
  const message = $("#createUserMessage");
  setFormMessage(message, "");

  const payload = {
    username: $("#newUsernameInput").value.trim(),
    displayName: $("#newDisplayNameInput").value.trim(),
    password: $("#newPasswordInput").value,
    role: $("#newRoleSelect").value,
  };

  if (!isValidPasswordText(payload.password)) {
    setFormMessage(message, "비밀번호는 영문과 숫자만 사용할 수 있습니다.", true);
    return;
  }

  if (isLocalPreview()) {
    try {
      createLocalUser(payload);
      $("#createUserForm").reset();
      setFormMessage(message, "사용자를 추가했습니다.");
      logClientAction("create_user", payload.username);
      await loadAdminData();
    } catch (error) {
      setFormMessage(message, error.message || "사용자를 만들지 못했습니다.", true);
    }
    return;
  }

  try {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setFormMessage(message, data.error || "사용자를 만들지 못했습니다.", true);
      return;
    }
    $("#createUserForm").reset();
    setFormMessage(message, "사용자를 추가했습니다.");
    logClientAction("create_user", payload.username);
    await loadAdminData();
  } catch {
    setFormMessage(message, "사용자를 만들지 못했습니다.", true);
  }
}

async function handleUserManagementClick(event) {
  const deleteButton = event.target.closest("[data-delete-user]");
  const resetButton = event.target.closest("[data-reset-user]");
  if (!deleteButton && !resetButton) return;

  const message = $("#manageUserMessage");
  setFormMessage(message, "");

  if (deleteButton) {
    const username = deleteButton.dataset.deleteUser;
    if (!confirm(`${username} 사용자를 삭제할까요? 이 계정은 더 이상 로그인할 수 없습니다.`)) return;

    if (isLocalPreview()) {
      try {
        deleteLocalUser(username);
        setFormMessage(message, `${username} 사용자를 삭제했습니다.`);
        logClientAction("delete_user", username);
        await loadAdminData();
      } catch (error) {
        setFormMessage(message, error.message || "사용자를 삭제하지 못했습니다.", true);
      }
      return;
    }

    try {
      const response = await fetch(`/api/users?username=${encodeURIComponent(username)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) {
        setFormMessage(message, data.error || "사용자를 삭제하지 못했습니다.", true);
        return;
      }
      setFormMessage(message, `${data.user.username} 사용자를 삭제했습니다.`);
      await loadAdminData();
    } catch {
      setFormMessage(message, "사용자를 삭제하지 못했습니다.", true);
    }
    return;
  }

  if (resetButton) {
    const username = resetButton.dataset.resetUser;
    if (!confirm(`${username} 사용자를 암호 리셋 상태로 바꿀까요? 사용자는 로그인 화면에서 아이디만 입력한 뒤 새 암호를 직접 설정합니다.`)) return;

    if (isLocalPreview()) {
      try {
        const result = requestLocalUserPasswordReset(username);
        setFormMessage(message, `${result.user.username} 암호 리셋을 설정했습니다. 사용자는 아이디만 입력해서 새 암호를 설정하면 됩니다.`);
        logClientAction("reset_user_password", username);
        await loadAdminData();
      } catch (error) {
        setFormMessage(message, error.message || "암호 리셋을 설정하지 못했습니다.", true);
      }
      return;
    }

    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "reset_password", username }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFormMessage(message, data.error || "암호 리셋을 설정하지 못했습니다.", true);
        return;
      }
      setFormMessage(message, `${data.user.username} 암호 리셋을 설정했습니다. 사용자는 아이디만 입력해서 새 암호를 설정하면 됩니다.`);
      await loadAdminData();
    } catch {
      setFormMessage(message, "암호 리셋을 설정하지 못했습니다.", true);
    }
  }
}

async function handleChangePassword(event) {
  event.preventDefault();
  const message = $("#changePasswordMessage");
  setFormMessage(message, "");

  const currentPassword = $("#currentPasswordInput").value;
  const newPassword = $("#changePasswordInput").value;
  const confirmPassword = $("#confirmPasswordInput").value;

  if (newPassword !== confirmPassword) {
    setFormMessage(message, "새 비밀번호가 서로 다릅니다.", true);
    return;
  }
  if (!isValidPasswordText(newPassword) || (!currentUser?.passwordResetRequired && !isValidPasswordText(currentPassword))) {
    setFormMessage(message, "비밀번호는 영문과 숫자만 사용할 수 있습니다.", true);
    return;
  }

  if (isLocalPreview()) {
    try {
      setCurrentUser(updateLocalPassword(currentUser.username, currentPassword, newPassword));
    } catch (error) {
      setFormMessage(message, error.message || "비밀번호를 변경하지 못했습니다.", true);
      return;
    }
    sessionStorage.setItem("seasonContributionUser", JSON.stringify(currentUser));
    $("#changePasswordForm").reset();
    setFormMessage(message, "비밀번호를 변경했습니다.");
    logClientAction("change_password", "로컬 미리보기");
    showView("result");
    render();
    return;
  }

  try {
    const response = await fetch("/api/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await response.json();
    if (!response.ok) {
      setFormMessage(message, data.error || "비밀번호를 변경하지 못했습니다.", true);
      return;
    }
    setCurrentUser(data.user);
    $("#changePasswordForm").reset();
    setFormMessage(message, "비밀번호를 변경했습니다.");
    logClientAction("change_password", currentUser.username);
    showView("result");
    render();
  } catch {
    setFormMessage(message, "비밀번호를 변경하지 못했습니다.", true);
  }
}

function setFormMessage(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle("is-error", isError);
}

async function logClientAction(action, detail = "") {
  if (!currentUser) return;

  if (isLocalPreview()) {
    const logs = JSON.parse(localStorage.getItem("seasonContributionLocalLogs") || "[]");
    logs.unshift({
      at: new Date().toISOString(),
      username: currentUser.username,
      displayName: currentUser.displayName || "",
      action,
      detail,
      ip: "로컬 미리보기",
    });
    localStorage.setItem("seasonContributionLocalLogs", JSON.stringify(logs.slice(0, 100)));
    return;
  }

  fetch("/api/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action, detail }),
  }).catch(() => {});
}

async function loadAdminData() {
  if (!isAdmin) return;

  if (isLocalPreview()) {
    renderUsers(getLocalUsers().map(cleanLocalUser));
    renderAccessLogs(JSON.parse(localStorage.getItem("seasonContributionLocalLogs") || "[]"));
    return;
  }

  const [usersResponse, logsResponse] = await Promise.all([
    fetch("/api/users", { credentials: "include" }),
    fetch("/api/logs", { credentials: "include" }),
  ]);
  if (usersResponse.ok) {
    const data = await usersResponse.json();
    renderUsers(data.users || []);
  }
  if (logsResponse.ok) {
    const data = await logsResponse.json();
    renderAccessLogs(data.logs || []);
  }
}

async function loadStateBackups() {
  if (!isAdmin) return;
  const message = $("#backupMessage");
  setFormMessage(message, "");

  if (isLocalPreview()) {
    renderStateBackups([]);
    setFormMessage(message, "로컬 미리보기에서는 서버 자동 백업을 사용할 수 없습니다.", true);
    return;
  }

  try {
    const response = await fetch("/api/state?backups=1", { credentials: "include" });
    const data = await response.json();
    if (!response.ok) {
      setFormMessage(message, data.error || "백업 목록을 불러오지 못했습니다.", true);
      return;
    }
    renderStateBackups(data.backups || []);
  } catch {
    setFormMessage(message, "백업 목록을 불러오지 못했습니다.", true);
  }
}

async function handleBackupRestoreClick(event) {
  const button = event.target.closest("[data-restore-backup]");
  if (!button) return;

  const backupId = button.dataset.restoreBackup;
  if (!confirm("이 백업으로 되돌릴까요? 현재 상태도 복구 전 자동 백업으로 저장됩니다.")) return;

  const message = $("#backupMessage");
  setFormMessage(message, "");
  button.disabled = true;
  button.textContent = "복구 중";

  try {
    const response = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ backupId }),
    });
    const data = await response.json();
    if (!response.ok) {
      setFormMessage(message, data.error || "백업을 복구하지 못했습니다.", true);
      return;
    }

    applyServerState(data.state);
    setFormMessage(message, "백업을 복구했습니다.");
    await loadStateBackups();
    render();
  } catch {
    setFormMessage(message, "백업을 복구하지 못했습니다.", true);
  } finally {
    button.disabled = false;
    button.textContent = "복구";
  }
}

async function startApp() {
  bindEvents();
  window.addEventListener("beforeunload", flushStateSave);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted || wasRedirectedAfterFailedLogin()) {
      resetLoginAfterRedirect();
      return;
    }
    if (!currentUser) $("#loginMessage").textContent = "";
  });
  await checkSession();
  resetLoginAfterRedirect();
  render();
}

startApp();
