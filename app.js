(() => {
  "use strict";

  const SEED_PLAYERS = ["Cole Laursen", "Ori Young", "Jasper Rochette", "Joey Martin", "Max Melchiorre", "Kyle Elliot", "Dylan Santucci", "Martin Heath", "Cristian Laverde", "Jude Brantley", "Kevin Sarmiento", "Dylan Nelson", "Michael Russomano", "Caden Devers", "Zach Pyskaty", "Jake Guarneri", "Cam Shwartz", "Joey Perosi", "Camilo", "Zack Miron", "Lucas Esposito", "Jack Kwapinski", "Jordan Lockhart", "Aaron Willam", "Gian Cases", "Mark Stefanelli", "Mateusz Worosz", "Matt Stankowitz", "Anthony Alborea", "Ryan Jarvie", "Bryce Hamilton", "Jude Urban", "Nathaniel B", "Youssef Ouda", "Jacob J Gorfinkle", "Matt Shumsky", "Brian Freitas", "Joseph Elshamy", "Kendrick Mercredi", "Aydan Mutton"];
  const cfg = window.XO_CONFIG || {};
  const configured =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_PUBLISHABLE_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") &&
    !cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");

  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY)
    : null;

  let players = [];
  let matches = [];
  let identityClaims = [];
  let claimStatus = [];
  let profiles = [];
  let auditLogs = [];
  let seasons = [];
  let seasonStats = [];
  let selectedSeasonId = null;
  let currentUser = null;
  let myProfile = null;
  let authMode = "signin";
  let realtimeChannel = null;
  const playerProfileCache = new Map();
  const statsMatchesCache = new Map();
  const advancedStatsCache = new Map();
  let advancedStatsLoading = false;
  let statsPlayerAId = null;
  let statsPlayerBId = null;
  let statsLoading = false;
  let openProfilePlayerId = null;

  // Upgrade 6 — Community
  let communityMessages = [];
  let announcements = [];
  let chatMutes = [];
  let activeChatChannel = "community";
  let communityLoaded = false;
  let communityLoading = false;

  // Upgrade 7 — Tournaments
  let tournaments = [];
  let tournamentEntries = [];
  let tournamentMatches = [];
  let tournamentRatingResults = [];
  let tournamentLoaded = false;
  let tournamentLoading = false;
  let selectedTournamentId = null;
  let tournamentEntrantSelection = new Set();
  let tournamentResultMatchId = null;

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));

  function isCommissioner() {
    return myProfile?.role === "commissioner";
  }

  function linkedPlayer() {
    return myProfile?.player_id ? playerById(myProfile.player_id) : null;
  }

  function setMessage(el, text, type="") {
    if (!el) return;
    el.textContent = text || "";
    el.className = "form-message" + (type ? ` ${type}` : "");
  }

  function setView(id) {
    $$(".view").forEach(v => v.classList.toggle("active", v.id === id));
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === id));
    if (id === "commissioner") renderCommissionerGate();
    if (id === "my-matches") renderMyMatches();
    if (id === "stats") {
      renderStatsHub();
      loadStatsMatches();
      loadAdvancedStatsData();
    }
    if (id === "community") {
      renderCommunity();
      loadCommunityData();
    }
    if (id === "tournaments") {
      renderTournamentHub();
      loadTournamentData();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function sortedPlayers() {
    return [...players].filter(p => p.active !== false).sort((a,b) => {
      if (!!a.provisional !== !!b.provisional) return a.provisional ? 1 : -1;
      return b.rating - a.rating || a.name.localeCompare(b.name);
    });
  }

  function activeSeason() {
    return seasons.find(s => s.status === "active") || null;
  }

  function seasonById(id) {
    return seasons.find(s => s.id === id) || null;
  }

  function seasonStat(seasonId, playerId) {
    return seasonStats.find(s => s.season_id === seasonId && s.player_id === playerId) || null;
  }

  function seasonRows(seasonId) {
    return seasonStats
      .filter(s => s.season_id === seasonId && s.active !== false)
      .map(s => {
        const p = playerById(s.player_id);
        return {
          ...p,
          id: s.player_id,
          rating: s.rating,
          rating_deviation: s.rating_deviation,
          wins: s.wins,
          losses: s.losses,
          provisional: s.provisional,
          previous_rank: s.previous_rank,
          peak_rating: s.peak_rating,
          last_played_at: s.last_played_at,
          active: s.active,
          season_id: s.season_id
        };
      })
      .filter(p => p.name)
      .sort((a,b) => {
        if (!!a.provisional !== !!b.provisional) return a.provisional ? 1 : -1;
        return b.rating - a.rating || a.name.localeCompare(b.name);
      });
  }

  function selectedRows() {
    return selectedSeasonId && selectedSeasonId !== "all"
      ? seasonRows(selectedSeasonId)
      : sortedPlayers();
  }

  function activeSeasonRows() {
    const s = activeSeason();
    return s ? seasonRows(s.id) : sortedPlayers();
  }

  function officialPlayers(rows = selectedRows()) {
    return rows.filter(p => !p.provisional);
  }

  function currentRankMap(rows = selectedRows()) {
    return Object.fromEntries(officialPlayers(rows).map((p,i) => [p.id, i+1]));
  }

  function movementFor(p, rank) {
    if (p.provisional || !rank || !p.previous_rank) return 0;
    return Number(p.previous_rank) - rank;
  }

  function confidenceLabel(rd) {
    const value = Number(rd ?? 350);
    if (value <= 90) return "High";
    if (value <= 160) return "Med";
    return "Low";
  }

  function playerById(id) {
    return players.find(p => p.id === id);
  }

  function profileById(id) {
    return profiles.find(p => p.id === id);
  }

  function matchNames(m) {
    const names = [m.a1,m.a2,m.b1,m.b2].map(id => playerById(id)?.name || "Unknown");
    return { teamA:`${names[0]} / ${names[1]}`, teamB:`${names[2]} / ${names[3]}` };
  }

  function statusLabel(status) {
    return ({
      awaiting_confirmation:"Awaiting opponent",
      pending:"Confirmed",
      disputed:"Disputed",
      approved:"Approved",
      rejected:"Rejected"
    })[status] || status;
  }

  function statusClass(status) {
    if (status === "approved") return "status-approved";
    if (status === "disputed" || status === "rejected") return "status-disputed";
    if (status === "pending") return "status-confirmed";
    return "status-waiting";
  }

  function playerIsOnTeam(m, playerId, team) {
    if (!playerId) return false;
    return team === "A" ? [m.a1,m.a2].includes(playerId) : [m.b1,m.b2].includes(playerId);
  }

  function seasonNameForMatch(m) {
    return seasonById(m.season_id)?.name || "All-Time";
  }

  function renderSeasonControls() {
    const current = activeSeason();

    if (!selectedSeasonId && seasons.length) {
      selectedSeasonId = current?.id || "all";
    }
    if (selectedSeasonId && selectedSeasonId !== "all" && !seasonById(selectedSeasonId)) {
      selectedSeasonId = current?.id || "all";
    }

    const select = $("seasonSelect");
    if (select) {
      const options = [
        ...seasons.map(s => `<option value="${s.id}" ${selectedSeasonId === s.id ? "selected" : ""}>${esc(s.name)}${s.status === "active" ? " • ACTIVE" : ""}</option>`),
        `<option value="all" ${selectedSeasonId === "all" ? "selected" : ""}>All-Time</option>`
      ];
      select.innerHTML = options.join("");
    }

    const selected = selectedSeasonId === "all" ? null : seasonById(selectedSeasonId);
    const context = selected ? selected.name : "All-Time";
    if ($("seasonContextLabel")) $("seasonContextLabel").textContent = context;
    if ($("currentSeasonBadge")) {
      $("currentSeasonBadge").textContent = current ? `${current.name} • LIVE` : "No active season";
    }
    if ($("submitSeasonTag")) $("submitSeasonTag").textContent = current ? current.name : "No active season";
    if ($("commissionerActiveSeason")) {
      $("commissionerActiveSeason").innerHTML = current
        ? `<strong>${esc(current.name)}</strong><span>${current.starting_mode === "fresh" ? "Fresh ratings" : "Carried ratings"} • active season</span>`
        : `<strong>No active season</strong><span>Create a season before matches can be submitted.</span>`;
    }
  }

  function renderLeaderboard() {
    const q = $("playerSearch").value.trim().toLowerCase();
    const rankingRows = selectedRows();
    const rankMap = currentRankMap(rankingRows);
    const rows = rankingRows.filter(p => p.name.toLowerCase().includes(q));

    $("leaderBody").innerHTML = rows.map((p) => {
      const gp = (p.wins || 0) + (p.losses || 0);
      const rank = rankMap[p.id];
      const movement = movementFor(p, rank);
      const moveClass = movement > 0 ? "move-up" : movement < 0 ? "move-down" : "move-flat";
      const moveText = p.provisional
        ? `${Math.max(0, 5-gp)} game${Math.max(0, 5-gp) === 1 ? "" : "s"} left`
        : movement > 0 ? `↑ ${movement}` : movement < 0 ? `↓ ${Math.abs(movement)}` : "—";
      const rd = Number(p.rating_deviation ?? 350);
      const rankCell = p.provisional ? `<span class="prov-badge">PROV</span>` : `#${rank}`;
      const claimed = claimStatus.find(c => c.player_id === p.id)?.is_claimed;
      const verifiedBadge = claimed
        ? `<span class="verified-badge" title="Verified league account" aria-label="Verified league account">✓</span>`
        : "";
      return `<tr class="${!p.provisional && rank <= 10 ? "top10" : ""} ${!p.provisional && rank <= 3 ? "top3" : ""} ${p.provisional ? "provisional-row" : ""}">
        <td class="rank">${rankCell}</td>
        <td class="player-name"><div class="player-name-wrap"><button class="player-link" data-player-profile="${p.id}">${esc(p.name)}</button>${verifiedBadge}</div></td>
        <td class="rating">${p.rating}</td>
        <td>${p.wins || 0}-${p.losses || 0}</td>
        <td>${gp}</td>
        <td><span class="confidence-pill ${confidenceLabel(rd).toLowerCase()}">${confidenceLabel(rd)} ±${rd}</span></td>
        <td class="${moveClass}">${moveText}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="7"><div class="empty">No players found.</div></td></tr>`;

    const approved = matches.filter(m =>
      m.status === "approved" &&
      (selectedSeasonId === "all" || m.season_id === selectedSeasonId)
    ).length;
    const reviewCount = matches.filter(m => ["pending","disputed"].includes(m.status)).length;

    $("statPlayers").textContent = rankingRows.length;
    $("statMatches").textContent = approved;
    $("statPending").textContent = isCommissioner() ? reviewCount : "—";
    $("statTop").textContent = officialPlayers(rankingRows)[0]?.rating ?? "—";
  }

  function options(selected="") {
    const roster = activeSeasonRows();
    return `<option value="">Choose player</option>` + roster.map(p =>
      `<option value="${p.id}" ${selected === p.id ? "selected" : ""}>${esc(p.name)} (${p.rating}${p.provisional ? " • PROV" : ""})</option>`
    ).join("");
  }

  function renderSelects() {
    ["a1","a2","b1","b2","editPlayer"].forEach(id => {
      const el = $(id);
      if (!el) return;
      const old = el.value;
      el.innerHTML = options(old);
    });

    const claimEl = $("claimPlayerSelect");
    if (claimEl) {
      const old = claimEl.value;
      const available = claimStatus.filter(c => !c.is_claimed);
      claimEl.innerHTML = `<option value="">Choose your roster name</option>` + available.map(c =>
        `<option value="${c.player_id}" ${old === c.player_id ? "selected" : ""}>${esc(c.player_name)}</option>`
      ).join("");
    }

    const unlink = $("unlinkPlayer");
    if (unlink) {
      const old = unlink.value;
      const claimed = claimStatus.filter(c => c.is_claimed);
      unlink.innerHTML = `<option value="">Choose linked player</option>` + claimed.map(c =>
        `<option value="${c.player_id}" ${old === c.player_id ? "selected" : ""}>${esc(c.player_name)}</option>`
      ).join("");
    }
    updateTeamLabels();
  }

  function updateTeamLabels() {
    const activeRows = activeSeasonRows();
    const activeById = id => activeRows.find(p => p.id === id);
    const name = id => playerById($(id).value)?.name || "—";
    const rating = id => activeById($(id).value)?.rating;
    $("teamALabel").textContent = `${name("a1")} / ${name("a2")}`;
    $("teamBLabel").textContent = `${name("b1")} / ${name("b2")}`;
    const ar = [rating("a1"),rating("a2")];
    const br = [rating("b1"),rating("b2")];
    $("teamAAvg").textContent = ar.every(Number.isFinite) ? `Avg ${Math.round((ar[0]+ar[1])/2)}` : "—";
    $("teamBAvg").textContent = br.every(Number.isFinite) ? `Avg ${Math.round((br[0]+br[1])/2)}` : "—";
  }

  function renderIdentity() {
    const signed = !!currentUser;
    const lp = linkedPlayer();
    const myPending = signed ? identityClaims.find(c => c.user_id === currentUser.id && c.status === "pending") : null;

    $("identityNeeded").classList.toggle("hidden", !signed || !!lp);
    $("identityReady").classList.toggle("hidden", !signed || !lp);
    if (signed && lp) {
      $("identityReady").innerHTML = `<strong>Verified as ${esc(lp.name)}</strong><span> • match submissions are tied to your player identity</span>`;
    }

    const tag = $("identityStatusTag");
    const linkedCard = $("linkedIdentityCard");
    const claimBox = $("claimIdentityBox");
    const pendingBox = $("claimPendingBox");

    if (!signed) {
      tag.textContent = "Sign in first";
      linkedCard.classList.add("hidden");
      claimBox.classList.add("hidden");
      pendingBox.classList.add("hidden");
      return;
    }

    if (lp) {
      tag.textContent = "Verified";
      tag.className = "tag verified-tag";
      linkedCard.classList.remove("hidden");
      linkedCard.innerHTML = `<div class="identity-avatar">${esc(lp.name.split(/\s+/).map(x => x[0]).slice(0,2).join(""))}</div><div><strong>${esc(lp.name)}</strong><span>Account linked • rating ${lp.rating}${lp.provisional ? " • PROV" : ""}</span></div>`;
      claimBox.classList.add("hidden");
      pendingBox.classList.add("hidden");
      return;
    }

    linkedCard.classList.add("hidden");
    tag.className = "tag gold";
    if (myPending) {
      const target = playerById(myPending.player_id);
      tag.textContent = "Awaiting Ori";
      claimBox.classList.add("hidden");
      pendingBox.classList.remove("hidden");
      pendingBox.innerHTML = `<strong>Claim pending:</strong> ${esc(target?.name || "Player")}<br><span>Ori needs to approve this once. After that you can submit and confirm matches.</span>`;
    } else {
      tag.textContent = "Not linked";
      claimBox.classList.remove("hidden");
      pendingBox.classList.add("hidden");
    }
  }

  function renderMyMatches() {
    renderIdentity();
    const lp = linkedPlayer();
    if (!currentUser || !lp) {
      $("confirmBadge").textContent = "0 waiting";
      $("confirmationList").innerHTML = `<div class="empty">Link your player identity to confirm scores.</div>`;
      $("myMatchList").innerHTML = `<div class="empty">Your match workflow will appear here once your identity is approved.</div>`;
      return;
    }

    const tasks = matches.filter(m =>
      m.status === "awaiting_confirmation" &&
      playerIsOnTeam(m, lp.id, m.confirmation_required_team)
    );
    $("confirmBadge").textContent = `${tasks.length} waiting`;
    $("confirmationList").innerHTML = tasks.length ? tasks.map(m => {
      const n = matchNames(m);
      return `<article class="match-card confirmation-card">
        <div class="match-card-head"><strong>${esc(n.teamA)} <span>vs</span> ${esc(n.teamB)}</strong><span class="status-pill status-waiting">VERIFY</span></div>
        <small>${esc(seasonNameForMatch(m))} • Reported score: <b>${m.score_a}-${m.score_b}</b> • submitted ${new Date(m.created_at).toLocaleString()}</small>
        <div class="confirm-actions">
          <button class="btn confirm-btn" data-confirm="${m.id}">Confirm score</button>
          <input class="input dispute-input" data-dispute-input="${m.id}" maxlength="500" placeholder="If wrong, say what needs fixing…" />
          <button class="btn outline reject-btn" data-dispute="${m.id}">Dispute</button>
        </div>
      </article>`;
    }).join("") : `<div class="empty">No scores need your confirmation.</div>`;

    const mine = matches.filter(m => [m.a1,m.a2,m.b1,m.b2].includes(lp.id) || m.submitted_by === currentUser.id);
    $("myMatchList").innerHTML = mine.length ? mine.map(m => {
      const n = matchNames(m);
      let extra = "";
      if (m.status === "awaiting_confirmation") extra = `Waiting for Team ${m.confirmation_required_team} to confirm.`;
      if (m.status === "pending") extra = "Opponent confirmed. Waiting for Ori's final approval.";
      if (m.status === "disputed") extra = `Disputed${m.dispute_reason ? `: ${esc(m.dispute_reason)}` : "."}`;
      if (m.status === "approved") extra = "Finalized and applied to rankings.";
      if (m.status === "rejected") extra = "Rejected by commissioner.";
      return `<article class="match-card">
        <div class="match-card-head"><strong>${esc(n.teamA)} <span>vs</span> ${esc(n.teamB)}</strong><span class="status-pill ${statusClass(m.status)}">${esc(statusLabel(m.status))}</span></div>
        <small>${esc(seasonNameForMatch(m))} • ${m.score_a}-${m.score_b} • ${extra} • ${new Date(m.created_at).toLocaleString()}</small>
      </article>`;
    }).join("") : `<div class="empty">No matches tied to your player identity yet.</div>`;
  }

  function renderPending() {
    const reviewable = matches.filter(m => ["pending","disputed"].includes(m.status));
    $("pendingBadge").textContent = `${reviewable.length} review`;
    $("pendingList").innerHTML = reviewable.length ? reviewable.map(m => {
      const n = matchNames(m);
      const disputed = m.status === "disputed";
      return `<article class="match-card ${disputed ? "disputed-card" : ""}">
        <div class="match-card-head"><strong>${esc(n.teamA)} <span>vs</span> ${esc(n.teamB)}</strong><span class="status-pill ${statusClass(m.status)}">${esc(statusLabel(m.status))}</span></div>
        <small>${esc(seasonNameForMatch(m))} • ${m.score_a}-${m.score_b} • ${disputed ? `dispute: ${esc(m.dispute_reason || "No reason")}` : "opponent confirmed"} • ${new Date(m.created_at).toLocaleString()}</small>
        <div class="match-actions">
          <button class="btn approve-btn" data-review="${m.id}" data-decision="approved">${disputed ? "Resolve & approve" : "Approve"}</button>
          <button class="btn outline reject-btn" data-review="${m.id}" data-decision="rejected">Reject</button>
        </div>
      </article>`;
    }).join("") : `<div class="empty">No confirmed or disputed scores need review.</div>`;
  }

  function renderClaimQueue() {
    const pending = identityClaims.filter(c => c.status === "pending");
    $("claimQueueBadge").textContent = `${pending.length} pending`;
    $("claimQueueList").innerHTML = pending.length ? pending.map(c => {
      const player = playerById(c.player_id);
      const profile = profileById(c.user_id);
      return `<article class="match-card claim-card">
        <strong>${esc(profile?.full_name || "League account")}</strong>
        <small>requests identity <b>${esc(player?.name || "Unknown player")}</b> • ${new Date(c.created_at).toLocaleString()}</small>
        <div class="match-actions">
          <button class="btn approve-btn" data-claim-review="${c.id}" data-decision="approved">Approve identity</button>
          <button class="btn outline reject-btn" data-claim-review="${c.id}" data-decision="rejected">Reject</button>
        </div>
      </article>`;
    }).join("") : `<div class="empty">No identity requests waiting.</div>`;
  }

  function auditDescription(a) {
    const d = a.details || {};
    const map = {
      identity_claim_requested:`requested identity ${d.player_name || ""}`,
      identity_claim_approved:`approved ${d.user_name || "account"} as ${d.player_name || "player"}`,
      identity_claim_rejected:`rejected ${d.user_name || "account"}'s claim for ${d.player_name || "player"}`,
      identity_unlinked:`unlinked ${d.user_name || "account"} from ${d.player_name || "player"}`,
      match_submitted:`submitted match ${d.score_a ?? "?"}-${d.score_b ?? "?"}`,
      match_confirmed:"confirmed an opponent-submitted score",
      match_disputed:`disputed a score${d.reason ? ` — ${d.reason}` : ""}`,
      match_approved:`approved a match ${d.score_a ?? "?"}-${d.score_b ?? "?"}`,
      match_rejected:`rejected a match ${d.score_a ?? "?"}-${d.score_b ?? "?"}`,
      player_added:`added ${d.player_name || "a player"} at ${d.starting_rating ?? "?"}`,
      rating_changed:`changed ${d.player_name || "a player"} from ${d.old_rating ?? "?"} to ${d.new_rating ?? "?"}`,
      season_created:`started ${d.season_name || "a new season"} (${d.starting_mode === "fresh" ? "fresh ratings" : "carried ratings"})`,
      chat_message_deleted:`deleted a ${d.channel || "chat"} message from ${d.author_name || "a player"}`,
      chat_user_muted:`muted ${d.player_name || d.user_name || "a player"}${d.hours === 0 ? " indefinitely" : ` for ${d.hours || "?"}h`}`,
      chat_user_unmuted:`unmuted ${d.player_name || d.user_name || "a player"}`,
      announcement_posted:`posted announcement "${d.title || "League update"}"`,
      announcement_deleted:`deleted announcement "${d.title || "League update"}"`,
      tournament_created:`created tournament "${d.tournament_name || "Tournament"}" (${d.size || "?"} players${d.affects_ratings ? ", Elo on" : ", exhibition"})`,
      tournament_match_recorded:`recorded ${d.player1_name || "Player"} ${d.score1 ?? "?"}-${d.score2 ?? "?"} ${d.player2_name || "Player"} in ${d.tournament_name || "a tournament"}`,
      tournament_completed:`crowned ${d.champion_name || "a champion"} in ${d.tournament_name || "a tournament"}`
    };
    return map[a.action] || a.action.replaceAll("_"," ");
  }

  function renderAudit() {
    $("auditList").innerHTML = auditLogs.length ? auditLogs.map(a => `
      <div class="audit-row">
        <div class="audit-icon">${a.action.startsWith("match_") ? "PB" : a.action.startsWith("identity_") ? "ID" : a.action.startsWith("chat_") ? "CH" : a.action.startsWith("announcement_") ? "AN" : a.action.startsWith("tournament_") ? "TR" : "XO"}</div>
        <div class="audit-copy"><strong>${esc(a.actor_name)}</strong><span>${esc(auditDescription(a))}</span></div>
        <time>${new Date(a.created_at).toLocaleString()}</time>
      </div>`).join("") : `<div class="empty">Audit events will appear here as the league is used.</div>`;
  }


  function initials(name) {
    return String(name || "?").trim().split(/\s+/).map(x => x[0]).filter(Boolean).slice(0,2).join("").toUpperCase();
  }

  function selectedProfileRow(playerId) {
    if (selectedSeasonId && selectedSeasonId !== "all") {
      return seasonRows(selectedSeasonId).find(p => p.id === playerId) || playerById(playerId);
    }
    return playerById(playerId);
  }

  function selectedProfileRank(playerId) {
    const rows = selectedRows();
    const p = rows.find(x => x.id === playerId);
    if (!p || p.provisional) return null;
    return currentRankMap(rows)[playerId] || null;
  }

  function resultScopeRows(rows) {
    if (selectedSeasonId && selectedSeasonId !== "all") {
      return rows.filter(r => r.season_id === selectedSeasonId);
    }
    return rows;
  }

  function matchScopeRows(rows) {
    if (selectedSeasonId && selectedSeasonId !== "all") {
      return rows.filter(m => m.season_id === selectedSeasonId);
    }
    return rows;
  }

  function scopedRatingBefore(r) {
    return selectedSeasonId && selectedSeasonId !== "all"
      ? Number(r.season_rating_before ?? r.rating_before)
      : Number(r.rating_before);
  }

  function scopedRatingAfter(r) {
    return selectedSeasonId && selectedSeasonId !== "all"
      ? Number(r.season_rating_after ?? r.rating_after)
      : Number(r.rating_after);
  }

  function scopedRatingDelta(r) {
    return selectedSeasonId && selectedSeasonId !== "all"
      ? Number(r.season_rating_delta ?? r.rating_delta)
      : Number(r.rating_delta);
  }

  function playerSideInfo(m, playerId) {
    const onA = [m.a1,m.a2].includes(playerId);
    const teamIds = onA ? [m.a1,m.a2] : [m.b1,m.b2];
    const oppIds = onA ? [m.b1,m.b2] : [m.a1,m.a2];
    const partnerId = teamIds.find(id => id !== playerId);
    const ownScore = onA ? m.score_a : m.score_b;
    const oppScore = onA ? m.score_b : m.score_a;
    return {
      onA,
      won: ownScore > oppScore,
      ownScore,
      oppScore,
      partnerId,
      opponentIds: oppIds,
      partner: playerById(partnerId)?.name || "Unknown",
      opponents: oppIds.map(id => playerById(id)?.name || "Unknown")
    };
  }

  function streakText(resultsDesc) {
    if (!resultsDesc.length) return "—";
    const first = resultsDesc[0].result;
    let n = 0;
    for (const r of resultsDesc) {
      if (r.result !== first) break;
      n++;
    }
    return `${first === "win" ? "W" : "L"}${n}`;
  }

  function mostCommonName(items) {
    if (!items.length) return { name:"—", count:0 };
    const counts = new Map();
    items.forEach(name => counts.set(name, (counts.get(name) || 0) + 1));
    return [...counts.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))
      .map(([name,count]) => ({name,count}))[0];
  }

  function ratingChartSvg(resultsAsc, currentRating) {
    if (!resultsAsc.length) {
      return `<div class="profile-empty-chart"><b>${currentRating ?? "—"}</b><span>Play approved matches to build a rating graph.</span></div>`;
    }
    const values = [scopedRatingBefore(resultsAsc[0]), ...resultsAsc.map(scopedRatingAfter)].filter(Number.isFinite);
    if (!values.length) return `<div class="profile-empty-chart">No rating history yet.</div>`;
    const width = 720, height = 230, padX = 28, padY = 26;
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { min -= 10; max += 10; }
    const extra = Math.max(8, Math.round((max-min)*.12));
    min -= extra; max += extra;
    const x = i => padX + (values.length === 1 ? 0 : i * (width-2*padX)/(values.length-1));
    const y = v => height-padY - ((v-min)/(max-min))*(height-2*padY);
    const points = values.map((v,i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const dots = values.map((v,i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4"><title>${v}</title></circle>`).join("");
    const gridVals = [max, (max+min)/2, min];
    const grid = gridVals.map(v => `<g><line x1="${padX}" y1="${y(v).toFixed(1)}" x2="${width-padX}" y2="${y(v).toFixed(1)}"/><text x="4" y="${(y(v)+4).toFixed(1)}">${Math.round(v)}</text></g>`).join("");
    return `<svg class="rating-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Rating history chart">
      <g class="chart-grid">${grid}</g>
      <polyline class="chart-line" points="${points}" />
      <g class="chart-dots">${dots}</g>
    </svg>`;
  }

  function profileMatchCard(m, playerId, deltaMap) {
    const info = playerSideInfo(m, playerId);
    const delta = deltaMap.get(m.id);
    const sign = Number(delta) > 0 ? "+" : "";
    return `<article class="profile-match-row">
      <span class="profile-result ${info.won ? "win" : "loss"}">${info.won ? "W" : "L"}</span>
      <div><strong>${esc(info.partner)}</strong><span>vs ${esc(info.opponents.join(" / "))}</span></div>
      <b>${info.ownScore}-${info.oppScore}</b>
      <span class="profile-delta ${Number(delta) >= 0 ? "positive" : "negative"}">${Number.isFinite(Number(delta)) ? `${sign}${delta}` : "—"}</span>
    </article>`;
  }

  async function openPlayerProfile(playerId) {
    const p = playerById(playerId);
    if (!p) return;
    openProfilePlayerId = playerId;
    $("playerProfileModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
    $("playerProfileContent").innerHTML = `<div class="profile-loading"><div class="profile-spinner"></div><span>Loading ${esc(p.name)}…</span></div>`;

    try {
      let data = playerProfileCache.get(playerId);
      if (!data) {
        if (!configured) {
          data = { results:[], matches:[] };
        } else {
          const [resultsRes, matchesRes] = await Promise.all([
            sb.from("match_player_results").select("*").eq("player_id", playerId).order("created_at", { ascending:true }),
            sb.from("matches").select("*").eq("status", "approved")
              .or(`a1.eq.${playerId},a2.eq.${playerId},b1.eq.${playerId},b2.eq.${playerId}`)
              .order("reviewed_at", { ascending:false }).limit(250)
          ]);
          if (resultsRes.error) throw resultsRes.error;
          if (matchesRes.error) throw matchesRes.error;
          data = { results:resultsRes.data || [], matches:matchesRes.data || [] };
          playerProfileCache.set(playerId, data);
        }
      }
      if (!advancedStatsCache.has(statsScopeKey())) {
        await loadAdvancedStatsData();
      }
      if (openProfilePlayerId === playerId) renderPlayerProfile(playerId, data.results, data.matches);
    } catch (err) {
      console.error(err);
      $("playerProfileContent").innerHTML = `<div class="profile-error">Could not load this profile. ${esc(err.message || err)}</div>`;
    }
  }

  function closePlayerProfile() {
    openProfilePlayerId = null;
    $("playerProfileModal").classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  function renderPlayerProfile(playerId, rawResults, rawMatches) {
    const base = playerById(playerId);
    const row = selectedProfileRow(playerId) || base;
    if (!base || !row) return;

    const results = resultScopeRows(rawResults).slice().sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
    const resultsDesc = [...results].reverse();
    const profileMatches = matchScopeRows(rawMatches).slice().sort((a,b) => new Date(b.reviewed_at || b.created_at)-new Date(a.reviewed_at || a.created_at));
    const gp = (row.wins || 0) + (row.losses || 0);
    const winPct = gp ? Math.round((row.wins || 0) * 1000 / gp) / 10 : 0;
    const rank = selectedProfileRank(playerId);
    const scopeName = selectedSeasonId === "all" ? "All-Time" : (seasonById(selectedSeasonId)?.name || "Season");
    const peak = selectedSeasonId !== "all"
      ? Number(row.peak_rating ?? row.rating)
      : Math.max(Number(row.rating || 0), ...results.map(scopedRatingAfter).filter(Number.isFinite), Number(row.rating || 0));
    const recent = resultsDesc.slice(0,10);
    const form = recent.map(r => r.result === "win" ? "W" : "L");
    const bestWin = results.filter(r => r.result === "win").sort((a,b) => scopedRatingDelta(b)-scopedRatingDelta(a))[0] || null;
    const worstLoss = results.filter(r => r.result === "loss").sort((a,b) => scopedRatingDelta(a)-scopedRatingDelta(b))[0] || null;
    const matchById = new Map(profileMatches.map(m => [m.id,m]));

    const partners = [], opponents = [];
    profileMatches.forEach(m => {
      const info = playerSideInfo(m, playerId);
      partners.push(info.partner);
      opponents.push(...info.opponents);
    });
    const topPartner = mostCommonName(partners);
    const topOpponent = mostCommonName(opponents);
    const deltaMap = new Map(results.map(r => [r.match_id, scopedRatingDelta(r)]));

    const signatureCard = (r, label, fallback) => {
      if (!r) return `<div class="signature-card"><span>${label}</span><strong>—</strong><small>${fallback}</small></div>`;
      const m = matchById.get(r.match_id);
      const info = m ? playerSideInfo(m, playerId) : null;
      const delta = scopedRatingDelta(r);
      return `<div class="signature-card"><span>${label}</span><strong>${delta > 0 ? "+" : ""}${delta} rating</strong><small>${info ? `${esc(info.partner)} vs ${esc(info.opponents.join(" / "))} • ${info.ownScore}-${info.oppScore}` : "Approved match"}</small></div>`;
    };

    $("playerProfileContent").innerHTML = `
      <div class="profile-hero">
        <div class="profile-avatar">${esc(initials(base.name))}</div>
        <div class="profile-title-block">
          <div class="panel-kicker">${esc(scopeName)} PLAYER PROFILE</div>
          <h2>${esc(base.name)}</h2>
          <div class="profile-status-line">
            ${row.provisional ? `<span class="prov-badge">PROV</span><span>${Math.max(0,5-gp)} game${Math.max(0,5-gp)===1?"":"s"} to official</span>` : `<span class="profile-rank">#${rank || "—"}</span><span>Official ranking</span>`}
            ${claimStatus.find(c => c.player_id === playerId)?.is_claimed ? `<span class="verified-profile">✓ Verified</span>` : ""}
          </div>
        </div>
        <div class="profile-big-rating"><b>${row.rating}</b><span>Rating</span></div>
      </div>

      <div class="profile-stat-grid">
        <div><span>Record</span><b>${row.wins || 0}-${row.losses || 0}</b></div>
        <div><span>Win %</span><b>${winPct}%</b></div>
        <div><span>Current streak</span><b>${streakText(resultsDesc)}</b></div>
        <div><span>Peak rating</span><b>${peak || row.rating}</b></div>
        <div><span>Confidence</span><b>${confidenceLabel(row.rating_deviation)} <small>±${row.rating_deviation ?? 350}</small></b></div>
        <div><span>Matches</span><b>${gp}</b></div>
      </div>

      <div class="profile-grid-two">
        <section class="profile-section chart-section">
          <div class="profile-section-head"><div><span>RATING HISTORY</span><h3>${esc(scopeName)} progression</h3></div><b>${results.length} tracked</b></div>
          ${ratingChartSvg(results, row.rating)}
        </section>
        <section class="profile-section">
          <div class="profile-section-head"><div><span>LAST 10</span><h3>Recent form</h3></div></div>
          <div class="form-strip">${form.length ? form.map(x => `<i class="${x === "W" ? "w" : "l"}">${x}</i>`).join("") : `<span>No approved matches yet.</span>`}</div>
          <div class="connection-grid">
            <div><span>Most-played partner</span><strong>${esc(topPartner.name)}</strong><small>${topPartner.count ? `${topPartner.count} match${topPartner.count===1?"":"es"}` : "No data"}</small></div>
            <div><span>Most-faced opponent</span><strong>${esc(topOpponent.name)}</strong><small>${topOpponent.count ? `${topOpponent.count} meeting${topOpponent.count===1?"":"s"}` : "No data"}</small></div>
          </div>
        </section>
      </div>

      <div class="signature-grid">
        ${signatureCard(bestWin, "BIGGEST WIN", "No wins yet")}
        ${signatureCard(worstLoss, "WORST LOSS", "No losses yet")}
      </div>

      <section class="profile-section profile-achievements-section">
        <div class="profile-section-head"><div><span>ACHIEVEMENTS</span><h3>Badge Cabinet</h3></div></div>
        <div class="profile-badge-cabinet">
          ${(() => {
            const adv=advancedStatsCache.get(statsScopeKey());
            const ctx=adv?buildAdvancedContext(statsMatchesCache.get(statsScopeKey())||[],adv):null;
            const badges=badgeDefinitionsForPlayer(playerId,ctx);
            return badges.length
              ? badges.map(b=>`<div class="profile-badge ${b.tier}"><span>${b.icon}</span><div><strong>${esc(b.name)}</strong><small>${esc(b.detail)}</small></div></div>`).join("")
              : `<div class="empty">No badges earned in this view yet.</div>`;
          })()}
        </div>
      </section>

      <section class="profile-section">
        <div class="profile-section-head"><div><span>MATCH LOG</span><h3>Recent approved matches</h3></div><b>${profileMatches.length} total</b></div>
        <div class="profile-match-list">
          ${profileMatches.length ? profileMatches.slice(0,10).map(m => profileMatchCard(m, playerId, deltaMap)).join("") : `<div class="empty">No approved matches in this view yet.</div>`}
        </div>
      </section>`;
  }


  function statsScopeKey() {
    return selectedSeasonId && selectedSeasonId !== "all" ? selectedSeasonId : "all";
  }

  function statsScopeName() {
    return selectedSeasonId === "all"
      ? "All-Time"
      : (seasonById(selectedSeasonId)?.name || activeSeason()?.name || "Season");
  }

  function statsRoster() {
    return selectedRows();
  }

  function ensureStatsPlayers() {
    const roster = statsRoster();
    if (!roster.length) {
      statsPlayerAId = null;
      statsPlayerBId = null;
      return;
    }
    if (!roster.some(p => p.id === statsPlayerAId)) statsPlayerAId = roster[0]?.id || null;
    if (!roster.some(p => p.id === statsPlayerBId) || statsPlayerBId === statsPlayerAId) {
      statsPlayerBId = roster.find(p => p.id !== statsPlayerAId)?.id || null;
    }
  }

  function statsPlayerOptions(selectedId) {
    return statsRoster().map(p =>
      `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${esc(p.name)}${p.provisional ? " • PROV" : ""}</option>`
    ).join("");
  }

  function renderStatsControls() {
    ensureStatsPlayers();
    const a = $("statsPlayerA");
    const b = $("statsPlayerB");
    if (a) a.innerHTML = statsPlayerOptions(statsPlayerAId);
    if (b) b.innerHTML = statsPlayerOptions(statsPlayerBId);

    const seasonSelect = $("statsSeasonSelect");
    if (seasonSelect) {
      seasonSelect.innerHTML = [
        ...seasons.map(s => `<option value="${s.id}" ${selectedSeasonId === s.id ? "selected" : ""}>${esc(s.name)}${s.status === "active" ? " • ACTIVE" : ""}</option>`),
        `<option value="all" ${selectedSeasonId === "all" ? "selected" : ""}>All-Time</option>`
      ].join("");
    }
    if ($("statsScopeLabel")) $("statsScopeLabel").textContent = statsScopeName();
  }

  function canonicalPair(a,b) {
    return [a,b].sort().join("|");
  }

  function opponentsInMatch(m, p1, p2) {
    return (
      ([m.a1,m.a2].includes(p1) && [m.b1,m.b2].includes(p2)) ||
      ([m.b1,m.b2].includes(p1) && [m.a1,m.a2].includes(p2))
    );
  }

  function partnersInMatch(m, p1, p2) {
    return (
      ([m.a1,m.a2].includes(p1) && [m.a1,m.a2].includes(p2)) ||
      ([m.b1,m.b2].includes(p1) && [m.b1,m.b2].includes(p2))
    );
  }

  function scoreForPlayer(m, playerId) {
    return [m.a1,m.a2].includes(playerId)
      ? { own:Number(m.score_a), opp:Number(m.score_b) }
      : { own:Number(m.score_b), opp:Number(m.score_a) };
  }

  function teamScoreForPair(m, p1, p2) {
    const onA = [m.a1,m.a2].includes(p1) && [m.a1,m.a2].includes(p2);
    return onA
      ? { own:Number(m.score_a), opp:Number(m.score_b), opponents:[m.b1,m.b2] }
      : { own:Number(m.score_b), opp:Number(m.score_a), opponents:[m.a1,m.a2] };
  }

  function currentRelationshipStreak(rows, evaluator) {
    if (!rows.length) return "—";
    const newest = [...rows].sort((a,b) => new Date(b.reviewed_at || b.created_at) - new Date(a.reviewed_at || a.created_at));
    const first = evaluator(newest[0]);
    let count = 0;
    for (const m of newest) {
      if (evaluator(m) !== first) break;
      count++;
    }
    return `${first ? "W" : "L"}${count}`;
  }

  function matchupHistoryRow(m, perspectiveId, partnerMode=false) {
    const aNames = [m.a1,m.a2].map(id => playerById(id)?.name || "Unknown");
    const bNames = [m.b1,m.b2].map(id => playerById(id)?.name || "Unknown");
    let won;
    if (partnerMode) {
      const pair = teamScoreForPair(m, statsPlayerAId, statsPlayerBId);
      won = pair.own > pair.opp;
    } else {
      const s = scoreForPlayer(m, perspectiveId);
      won = s.own > s.opp;
    }
    return `<article class="relationship-match-row">
      <span class="profile-result ${won ? "win" : "loss"}">${won ? "W" : "L"}</span>
      <div>
        <strong>${esc(aNames.join(" / "))}</strong>
        <span>vs ${esc(bNames.join(" / "))}</span>
      </div>
      <b>${m.score_a}-${m.score_b}</b>
      <time>${new Date(m.reviewed_at || m.created_at).toLocaleDateString()}</time>
    </article>`;
  }

  function renderHeadToHead(matchRows) {
    const p1 = playerById(statsPlayerAId);
    const p2 = playerById(statsPlayerBId);
    const rows = matchRows.filter(m => opponentsInMatch(m, statsPlayerAId, statsPlayerBId))
      .sort((a,b) => new Date(b.reviewed_at || b.created_at)-new Date(a.reviewed_at || a.created_at));

    let p1Wins = 0, p2Wins = 0, marginTotal = 0;
    rows.forEach(m => {
      const s = scoreForPlayer(m, statsPlayerAId);
      if (s.own > s.opp) p1Wins++; else p2Wins++;
      marginTotal += s.own - s.opp;
    });

    const avgMargin = rows.length ? marginTotal / rows.length : 0;
    const latest = rows[0] || null;
    const latestScore = latest ? scoreForPlayer(latest, statsPlayerAId) : null;
    const lastFive = rows.slice(0,5).map(m => {
      const s = scoreForPlayer(m, statsPlayerAId);
      return s.own > s.opp ? "W" : "L";
    });

    $("h2hMeetingsBadge").textContent = `${rows.length} meeting${rows.length===1?"":"s"}`;
    $("h2hSummary").innerHTML = rows.length ? `
      <div class="matchup-scoreboard">
        <button class="matchup-person" data-player-profile="${p1.id}"><span>${esc(initials(p1.name))}</span><strong>${esc(p1.name)}</strong><b>${p1Wins}</b></button>
        <div class="matchup-vs"><span>HEAD TO HEAD</span><strong>${p1Wins}-${p2Wins}</strong><small>${esc(statsScopeName())}</small></div>
        <button class="matchup-person" data-player-profile="${p2.id}"><span>${esc(initials(p2.name))}</span><strong>${esc(p2.name)}</strong><b>${p2Wins}</b></button>
      </div>
      <div class="relationship-metrics">
        <div><span>Leader</span><b>${p1Wins === p2Wins ? "Tied" : esc((p1Wins > p2Wins ? p1 : p2).name)}</b></div>
        <div><span>${esc(p1.name)} avg margin</span><b>${avgMargin > 0 ? "+" : ""}${avgMargin.toFixed(1)}</b></div>
        <div><span>Latest</span><b>${latestScore.own > latestScore.opp ? esc(p1.name) : esc(p2.name)} ${latestScore.own}-${latestScore.opp}</b></div>
        <div><span>${esc(p1.name)} last 5</span><b class="mini-form">${lastFive.map(x=>`<i class="${x==="W"?"w":"l"}">${x}</i>`).join("")}</b></div>
      </div>` :
      `<div class="relationship-empty"><strong>No head-to-head meetings yet.</strong><span>Once these two play against each other, their rivalry will appear here automatically.</span></div>`;

    $("h2hRecent").innerHTML = rows.length
      ? rows.slice(0,8).map(m => matchupHistoryRow(m, statsPlayerAId, false)).join("")
      : `<div class="empty">No approved head-to-head matches in this view.</div>`;
  }

  function renderPartnerChemistry(matchRows) {
    const p1 = playerById(statsPlayerAId);
    const p2 = playerById(statsPlayerBId);
    const rows = matchRows.filter(m => partnersInMatch(m, statsPlayerAId, statsPlayerBId))
      .sort((a,b) => new Date(b.reviewed_at || b.created_at)-new Date(a.reviewed_at || a.created_at));

    let wins = 0, losses = 0, pointsFor = 0, pointsAgainst = 0;
    rows.forEach(m => {
      const s = teamScoreForPair(m, statsPlayerAId, statsPlayerBId);
      pointsFor += s.own;
      pointsAgainst += s.opp;
      if (s.own > s.opp) wins++; else losses++;
    });
    const pct = rows.length ? wins * 100 / rows.length : 0;
    const diff = rows.length ? (pointsFor-pointsAgainst)/rows.length : 0;
    const streak = currentRelationshipStreak(rows, m => {
      const s = teamScoreForPair(m, statsPlayerAId, statsPlayerBId);
      return s.own > s.opp;
    });

    $("partnerGamesBadge").textContent = `${rows.length} together`;
    $("partnerSummary").innerHTML = rows.length ? `
      <div class="duo-identity">
        <span class="duo-avatar">${esc(initials(p1.name))}</span>
        <div><span>DUO</span><strong>${esc(p1.name)} + ${esc(p2.name)}</strong><small>${esc(statsScopeName())}</small></div>
        <span class="duo-avatar alt">${esc(initials(p2.name))}</span>
      </div>
      <div class="relationship-metrics chemistry-metrics">
        <div><span>Record</span><b>${wins}-${losses}</b></div>
        <div><span>Win rate</span><b>${pct.toFixed(1)}%</b></div>
        <div><span>Avg point diff</span><b>${diff > 0 ? "+" : ""}${diff.toFixed(1)}</b></div>
        <div><span>Current streak</span><b>${streak}</b></div>
      </div>` :
      `<div class="relationship-empty"><strong>No games together yet.</strong><span>When these two team up, their chemistry stats will build automatically.</span></div>`;

    $("partnerRecent").innerHTML = rows.length
      ? rows.slice(0,8).map(m => matchupHistoryRow(m, statsPlayerAId, true)).join("")
      : `<div class="empty">No approved matches as partners in this view.</div>`;
  }

  function buildDuoRows(matchRows) {
    const map = new Map();
    const addTeam = (ids, own, opp) => {
      const key = canonicalPair(ids[0],ids[1]);
      if (!map.has(key)) map.set(key, { ids:[...ids].sort(), wins:0, losses:0, gp:0, pf:0, pa:0 });
      const r = map.get(key);
      r.gp++; r.pf += Number(own); r.pa += Number(opp);
      if (Number(own) > Number(opp)) r.wins++; else r.losses++;
    };
    matchRows.forEach(m => {
      addTeam([m.a1,m.a2], m.score_a, m.score_b);
      addTeam([m.b1,m.b2], m.score_b, m.score_a);
    });
    return [...map.values()].map(r => ({
      ...r,
      winPct:r.gp ? r.wins/r.gp : 0,
      avgDiff:r.gp ? (r.pf-r.pa)/r.gp : 0
    }));
  }

  function renderBestDuos(matchRows) {
    const min = Math.max(1, Number($("duoMinGames")?.value || 3));
    const duos = buildDuoRows(matchRows)
      .filter(r => r.gp >= min)
      .sort((a,b) => b.winPct-a.winPct || b.gp-a.gp || b.avgDiff-a.avgDiff)
      .slice(0,10);

    $("bestDuosList").innerHTML = duos.length ? duos.map((d,i) => {
      const p1 = playerById(d.ids[0]), p2 = playerById(d.ids[1]);
      return `<div class="relationship-rank-row">
        <span class="relationship-rank">#${i+1}</span>
        <div><strong>${esc(p1?.name || "Unknown")} + ${esc(p2?.name || "Unknown")}</strong><span>${d.wins}-${d.losses} • ${d.gp} games • ${d.winPct*100 >= 0 ? (d.winPct*100).toFixed(1) : "0.0"}%</span></div>
        <b>${d.avgDiff > 0 ? "+" : ""}${d.avgDiff.toFixed(1)} <small>diff</small></b>
      </div>`;
    }).join("") : `<div class="empty">No duos have reached ${min} approved game${min===1?"":"s"} yet. Lower the minimum to see more.</div>`;
  }

  function renderRivalries(matchRows) {
    const map = new Map();
    matchRows.forEach(m => {
      [m.a1,m.a2].forEach(a => [m.b1,m.b2].forEach(b => {
        const ids = [a,b].sort();
        const key = ids.join("|");
        if (!map.has(key)) map.set(key,{ids,count:0,wins0:0,wins1:0});
        const r = map.get(key);
        r.count++;
        const first = ids[0];
        const s = scoreForPlayer(m, first);
        if (s.own > s.opp) r.wins0++; else r.wins1++;
      }));
    });
    const rows = [...map.values()].sort((a,b) => b.count-a.count || Math.abs(b.wins0-b.wins1)-Math.abs(a.wins0-a.wins1)).slice(0,10);
    $("rivalriesList").innerHTML = rows.length ? rows.map((r,i) => {
      const p1 = playerById(r.ids[0]), p2 = playerById(r.ids[1]);
      return `<div class="relationship-rank-row rivalry-row">
        <span class="relationship-rank">#${i+1}</span>
        <div><strong>${esc(p1?.name || "Unknown")} vs ${esc(p2?.name || "Unknown")}</strong><span>${r.count} meeting${r.count===1?"":"s"} • series ${r.wins0}-${r.wins1}</span></div>
        <button class="mini-compare-btn" data-compare-a="${r.ids[0]}" data-compare-b="${r.ids[1]}">Compare</button>
      </div>`;
    }).join("") : `<div class="empty">Rivalries will appear after approved matches are played.</div>`;
  }

  function renderStatsHub() {
    if (!$("statsPlayerA")) return;
    renderStatsControls();
    renderAdvancedStats();
    const p1 = playerById(statsPlayerAId);
    const p2 = playerById(statsPlayerBId);

    if (!p1 || !p2 || p1.id === p2.id) {
      $("statsStatus").textContent = "Choose two different players.";
      ["h2hSummary","partnerSummary","h2hRecent","partnerRecent","bestDuosList","rivalriesList"].forEach(id => {
        if ($(id)) $(id).innerHTML = `<div class="empty">Choose two different players.</div>`;
      });
      return;
    }

    const key = statsScopeKey();
    const rows = statsMatchesCache.get(key) || [];
    $("statsStatus").innerHTML = `<strong>${esc(p1.name)}</strong> and <strong>${esc(p2.name)}</strong> • ${esc(statsScopeName())}`;
    renderHeadToHead(rows);
    renderPartnerChemistry(rows);
    renderBestDuos(rows);
    renderRivalries(rows);
  }

  async function loadStatsMatches(force=false) {
    if (!$("statsLoading")) return;
    renderStatsControls();
    const key = statsScopeKey();
    if (!configured) {
      statsMatchesCache.set(key, matches.filter(m => m.status === "approved"));
      renderStatsHub();
      return;
    }
    if (!force && statsMatchesCache.has(key)) {
      renderStatsHub();
      return;
    }
    if (statsLoading) return;
    statsLoading = true;
    $("statsLoading").classList.remove("hidden");
    $("statsContent").classList.add("stats-dimmed");

    try {
      const all = [];
      const pageSize = 1000;
      for (let from=0; from<10000; from+=pageSize) {
        let q = sb.from("matches")
          .select("id,a1,a2,b1,b2,score_a,score_b,season_id,status,reviewed_at,created_at")
          .eq("status","approved")
          .order("reviewed_at", { ascending:false })
          .range(from, from+pageSize-1);
        if (selectedSeasonId && selectedSeasonId !== "all") q = q.eq("season_id", selectedSeasonId);
        const { data, error } = await q;
        if (error) throw error;
        const page = data || [];
        all.push(...page);
        if (page.length < pageSize) break;
      }
      statsMatchesCache.set(key, all);
      renderStatsHub();
    } catch (err) {
      console.error(err);
      $("statsStatus").textContent = `Could not load matchup stats: ${err.message || err}`;
    } finally {
      statsLoading = false;
      $("statsLoading").classList.add("hidden");
      $("statsContent").classList.remove("stats-dimmed");
    }
  }



  function advancedScopeResults(obj) {
    return obj?.results || [];
  }

  function advancedScopeTournamentResults(obj) {
    return obj?.tournamentResults || [];
  }

  function advancedScopeTournaments(obj) {
    return obj?.tournaments || [];
  }

  function resultRatingBeforeForScope(r) {
    return selectedSeasonId && selectedSeasonId !== "all"
      ? Number(r.season_rating_before ?? r.rating_before)
      : Number(r.rating_before);
  }

  function resultRatingDeltaForScope(r) {
    return selectedSeasonId && selectedSeasonId !== "all"
      ? Number(r.season_rating_delta ?? r.rating_delta)
      : Number(r.rating_delta);
  }

  function tournamentRatingDeltaForScope(r) {
    return selectedSeasonId && selectedSeasonId !== "all"
      ? Number(r.season_rating_delta ?? r.rating_delta)
      : Number(r.rating_delta);
  }

  function buildPlayerAdvancedMetrics(matchRows, resultRows) {
    const metrics = new Map();
    selectedRows().forEach(p => {
      metrics.set(p.id, {
        playerId:p.id,
        games:0,
        wins:0,
        losses:0,
        pointsFor:0,
        pointsAgainst:0,
        pointDiff:0,
        bestWinStreak:0,
        currentWinStreak:0,
        upsetWins:0
      });
    });

    matchRows.forEach(m => {
      const add = (pid, own, opp) => {
        if (!metrics.has(pid)) {
          metrics.set(pid, {
            playerId:pid,games:0,wins:0,losses:0,
            pointsFor:0,pointsAgainst:0,pointDiff:0,
            bestWinStreak:0,currentWinStreak:0,upsetWins:0
          });
        }
        const x = metrics.get(pid);
        x.games++;
        x.pointsFor += Number(own);
        x.pointsAgainst += Number(opp);
        if (Number(own) > Number(opp)) x.wins++; else x.losses++;
      };
      add(m.a1,m.score_a,m.score_b);
      add(m.a2,m.score_a,m.score_b);
      add(m.b1,m.score_b,m.score_a);
      add(m.b2,m.score_b,m.score_a);
    });

    metrics.forEach(x => {
      x.pointDiff = x.games ? (x.pointsFor - x.pointsAgainst) / x.games : 0;
    });

    const byPlayer = new Map();
    resultRows.forEach(r => {
      if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
      byPlayer.get(r.player_id).push(r);
    });

    byPlayer.forEach((rows,pid) => {
      rows.sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
      let best=0, run=0;
      rows.forEach(r => {
        if (r.result === "win") {
          run++;
          best=Math.max(best,run);
        } else {
          run=0;
        }
      });
      if (!metrics.has(pid)) {
        metrics.set(pid, {
          playerId:pid,games:0,wins:0,losses:0,
          pointsFor:0,pointsAgainst:0,pointDiff:0,
          bestWinStreak:0,currentWinStreak:0,upsetWins:0
        });
      }
      metrics.get(pid).bestWinStreak=best;

      let current=0;
      for (const r of [...rows].reverse()) {
        if (r.result !== "win") break;
        current++;
      }
      metrics.get(pid).currentWinStreak=current;
    });

    return metrics;
  }

  function calculateUpsets(matchRows,resultRows,metrics) {
    const receipt = new Map();
    resultRows.forEach(r => receipt.set(`${r.match_id}|${r.player_id}`,r));

    const upsets=[];
    matchRows.forEach(m => {
      const teamA=[m.a1,m.a2];
      const teamB=[m.b1,m.b2];
      const aRatings=teamA.map(pid => receipt.get(`${m.id}|${pid}`)).filter(Boolean).map(resultRatingBeforeForScope);
      const bRatings=teamB.map(pid => receipt.get(`${m.id}|${pid}`)).filter(Boolean).map(resultRatingBeforeForScope);
      if (aRatings.length!==2 || bRatings.length!==2) return;
      if (aRatings.some(x=>!Number.isFinite(x)) || bRatings.some(x=>!Number.isFinite(x))) return;

      const avgA=(aRatings[0]+aRatings[1])/2;
      const avgB=(bRatings[0]+bRatings[1])/2;
      const aWon=Number(m.score_a)>Number(m.score_b);
      const winnerIds=aWon?teamA:teamB;
      const loserIds=aWon?teamB:teamA;
      const winnerAvg=aWon?avgA:avgB;
      const loserAvg=aWon?avgB:avgA;
      const gap=loserAvg-winnerAvg;

      if (gap>0) {
        upsets.push({match:m,gap,winnerIds,loserIds,winnerAvg,loserAvg});
        if (gap>=75) {
          winnerIds.forEach(pid => {
            if (metrics.has(pid)) metrics.get(pid).upsetWins++;
          });
        }
      }
    });

    return upsets.sort((a,b)=>b.gap-a.gap);
  }

  function calculateWeeklyMovement(resultRows,tournamentResults) {
    const cutoff=Date.now()-7*24*60*60*1000;
    const deltas=new Map();

    resultRows.forEach(r => {
      if (new Date(r.created_at).getTime()<cutoff) return;
      const d=resultRatingDeltaForScope(r);
      if (!Number.isFinite(d)) return;
      deltas.set(r.player_id,(deltas.get(r.player_id)||0)+d);
    });

    tournamentResults.forEach(r => {
      if (new Date(r.created_at).getTime()<cutoff) return;
      const d=tournamentRatingDeltaForScope(r);
      if (!Number.isFinite(d)) return;
      deltas.set(r.player_id,(deltas.get(r.player_id)||0)+d);
    });

    return [...deltas.entries()]
      .map(([playerId,delta])=>({playerId,delta}))
      .sort((a,b)=>b.delta-a.delta || (playerById(a.playerId)?.name||"").localeCompare(playerById(b.playerId)?.name||""));
  }

  function buildAdvancedContext(matchRows,obj) {
    const results=advancedScopeResults(obj);
    const tournamentResults=advancedScopeTournamentResults(obj);
    const tournamentRows=advancedScopeTournaments(obj);
    const metrics=buildPlayerAdvancedMetrics(matchRows,results);
    const upsets=calculateUpsets(matchRows,results,metrics);
    const weekly=calculateWeeklyMovement(results,tournamentResults);
    const metricRows=[...metrics.values()];

    const maxStreak=Math.max(0,...metricRows.map(x=>x.bestWinStreak||0));
    const longestStreak={
      value:maxStreak,
      playerIds:metricRows.filter(x=>x.bestWinStreak===maxStreak && maxStreak>0).map(x=>x.playerId)
    };

    const maxGames=Math.max(0,...metricRows.map(x=>x.games||0));
    const mostActive={
      value:maxGames,
      playerIds:metricRows.filter(x=>x.games===maxGames && maxGames>0).map(x=>x.playerId)
    };

    const maxGiant=Math.max(0,...metricRows.map(x=>x.upsetWins||0));
    const giantKiller={
      value:maxGiant,
      playerIds:metricRows.filter(x=>x.upsetWins===maxGiant && maxGiant>0).map(x=>x.playerId)
    };

    const championships=new Map();
    tournamentRows.filter(t=>t.status==="completed" && t.champion_player_id).forEach(t => {
      championships.set(t.champion_player_id,(championships.get(t.champion_player_id)||0)+1);
    });

    const topWeekly=weekly.find(x=>x.delta>0);
    const weeklyLeader=topWeekly
      ? {value:topWeekly.delta,playerIds:weekly.filter(x=>x.delta===topWeekly.delta).map(x=>x.playerId)}
      : {value:0,playerIds:[]};

    return {
      metrics,
      upsets,
      biggestUpset:upsets[0]||null,
      weekly,
      longestStreak,
      mostActive,
      giantKiller,
      championships,
      weeklyLeader
    };
  }

  function badgeDefinitionsForPlayer(playerId,ctx) {
    const rows=selectedRows();
    const row=rows.find(p=>p.id===playerId);
    if (!row) return [];
    const rank=row.provisional?null:currentRankMap(rows)[playerId];
    const badges=[];

    if (rank===1) badges.push({key:"court-king",icon:"♛",name:"Court King",detail:"#1 ranked player",tier:"scarlet"});
    if (rank && rank<=10) badges.push({key:"top-ten",icon:"10",name:"Top 10",detail:`Ranked #${rank}`,tier:"gold"});
    if (Number(row.wins||0)>=10) badges.push({key:"ten-wins",icon:"10W",name:"10 Wins",detail:`${row.wins} wins`,tier:"bronze"});
    if (Number(row.wins||0)>=25) badges.push({key:"twenty-five-wins",icon:"25W",name:"25 Wins",detail:`${row.wins} wins`,tier:"silver"});

    if (ctx?.longestStreak?.playerIds?.includes(playerId) && ctx.longestStreak.value>0) {
      badges.push({key:"streak-king",icon:"🔥",name:"Streak King",detail:`${ctx.longestStreak.value} straight wins`,tier:"scarlet"});
    }
    if (ctx?.biggestUpset?.winnerIds?.includes(playerId)) {
      badges.push({key:"upset-artist",icon:"💥",name:"Upset Artist",detail:`+${Math.round(ctx.biggestUpset.gap)} rating upset`,tier:"gold"});
    }
    if (ctx?.mostActive?.playerIds?.includes(playerId) && ctx.mostActive.value>0) {
      badges.push({key:"ironman",icon:"⚡",name:"Most Active",detail:`${ctx.mostActive.value} games`,tier:"silver"});
    }
    if (ctx?.giantKiller?.playerIds?.includes(playerId) && ctx.giantKiller.value>0) {
      badges.push({key:"giant-killer",icon:"👹",name:"Giant Killer",detail:`${ctx.giantKiller.value} major upset win${ctx.giantKiller.value===1?"":"s"}`,tier:"scarlet"});
    }

    const titles=ctx?.championships?.get(playerId)||0;
    if (titles>0) {
      badges.push({key:"champion",icon:"🏆",name:"Tournament Champion",detail:`${titles} XO title${titles===1?"":"s"}`,tier:"gold"});
    }
    if (ctx?.weeklyLeader?.playerIds?.includes(playerId) && ctx.weeklyLeader.value>0) {
      badges.push({key:"weekly-rocket",icon:"↗",name:"Weekly Rocket",detail:`+${ctx.weeklyLeader.value} this week`,tier:"green"});
    }
    return badges;
  }

  function playerNameList(ids,max=2) {
    const names=(ids||[]).map(id=>playerById(id)?.name||"Unknown");
    if (!names.length) return "—";
    if (names.length<=max) return names.join(" & ");
    return `${names.slice(0,max).join(" & ")} +${names.length-max}`;
  }

  function awardCard(icon,label,title,detail,playerIds=[]) {
    return `<article class="league-award-card">
      <div class="league-award-icon">${icon}</div>
      <div class="league-award-copy">
        <span>${esc(label)}</span>
        <strong>${esc(title||"—")}</strong>
        <small>${esc(detail||"Not enough data yet")}</small>
      </div>
      ${playerIds?.[0]?`<button data-player-profile="${playerIds[0]}" aria-label="Open profile">View</button>`:""}
    </article>`;
  }

  function renderWeeklyMovers(ctx) {
    const root=$("weeklyMovers");
    if (!root) return;
    const positive=ctx.weekly.filter(x=>x.delta>0).slice(0,5);
    const negative=ctx.weekly.filter(x=>x.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,5);

    const rows=(arr,direction)=>arr.map((x,i)=>{
      const p=playerById(x.playerId);
      return `<button class="weekly-mover-row" data-player-profile="${x.playerId}">
        <span class="weekly-place">#${i+1}</span>
        <div><strong>${esc(p?.name||"Unknown")}</strong><small>${direction==="up"?"Riser":"Fall"}</small></div>
        <b class="${x.delta>=0?"positive":"negative"}">${x.delta>=0?"+":""}${x.delta}</b>
      </button>`;
    }).join("");

    root.innerHTML=(positive.length||negative.length)?`
      <div class="weekly-mover-column">
        <div class="weekly-mover-heading"><span>↗</span><strong>Top Risers</strong></div>
        ${positive.length?rows(positive,"up"):`<div class="empty compact-empty">No positive movement this week.</div>`}
      </div>
      <div class="weekly-mover-column">
        <div class="weekly-mover-heading"><span>↘</span><strong>Biggest Drops</strong></div>
        ${negative.length?rows(negative,"down"):`<div class="empty compact-empty">No rating drops this week.</div>`}
      </div>`:`<div class="empty">No rating movement in the last 7 days yet.</div>`;
  }

  function renderAchievementBoard(ctx) {
    const root=$("achievementBoard");
    if (!root) return;
    const holders=[];
    selectedRows().forEach(p=>{
      badgeDefinitionsForPlayer(p.id,ctx).forEach(b=>holders.push({playerId:p.id,badge:b}));
    });

    $("achievementCountBadge").textContent=`${holders.length} earned`;
    if (!holders.length) {
      root.innerHTML=`<div class="empty">Achievements will unlock as league results build up.</div>`;
      return;
    }

    const badgeMeta=[
      ["court-king","♛","Court King"],
      ["top-ten","10","Top 10"],
      ["ten-wins","10W","10 Wins"],
      ["twenty-five-wins","25W","25 Wins"],
      ["streak-king","🔥","Streak King"],
      ["upset-artist","💥","Upset Artist"],
      ["ironman","⚡","Most Active"],
      ["champion","🏆","Tournament Champion"],
      ["giant-killer","👹","Giant Killer"],
      ["weekly-rocket","↗","Weekly Rocket"]
    ];

    root.innerHTML=badgeMeta.map(([key,icon,name])=>{
      const earned=holders.filter(x=>x.badge.key===key);
      return `<article class="achievement-category ${earned.length?"":"locked"}">
        <div class="achievement-icon">${icon}</div>
        <div>
          <strong>${name}</strong>
          <span>${earned.length?earned.slice(0,4).map(x=>esc(playerById(x.playerId)?.name||"Unknown")).join(" • "):"Not earned yet"}${earned.length>4?` • +${earned.length-4}`:""}</span>
        </div>
        <b>${earned.length}</b>
      </article>`;
    }).join("");
  }

  function renderAdvancedPlayerTable(ctx) {
    const root=$("advancedPlayerTableBody");
    if (!root) return;
    const rows=selectedRows();
    const rankMap=currentRankMap(rows);

    root.innerHTML=rows.slice(0,20).map(p=>{
      const m=ctx.metrics.get(p.id)||{games:0,pointDiff:0,bestWinStreak:0,upsetWins:0};
      const gp=Number(p.wins||0)+Number(p.losses||0);
      const pct=gp?Number(p.wins||0)*100/gp:0;
      const badges=badgeDefinitionsForPlayer(p.id,ctx);
      return `<tr data-player-profile="${p.id}">
        <td>${p.provisional?`<span class="prov-mini">PROV</span>`:`#${rankMap[p.id]||"—"}`}</td>
        <td><strong>${esc(p.name)}</strong>${badges.length?`<small>${badges.slice(0,3).map(b=>b.icon).join(" ")}</small>`:""}</td>
        <td>${p.rating}</td>
        <td>${p.wins||0}-${p.losses||0}</td>
        <td>${pct.toFixed(1)}%</td>
        <td class="${m.pointDiff>0?"positive":m.pointDiff<0?"negative":""}">${m.pointDiff>0?"+":""}${m.pointDiff.toFixed(1)}</td>
        <td>${m.bestWinStreak||0}</td>
        <td>${m.upsetWins||0}</td>
      </tr>`;
    }).join("")||`<tr><td colspan="8">No players in this view.</td></tr>`;
  }

  function renderAdvancedStats() {
    if (!$("leagueAwardsGrid")) return;
    const key=statsScopeKey();
    const obj=advancedStatsCache.get(key);
    const matchRows=statsMatchesCache.get(key)||[];
    const rows=selectedRows();
    const official=rows.filter(p=>!p.provisional);
    const top=rows[0]||null;
    const avg=rows.length?Math.round(rows.reduce((sum,p)=>sum+Number(p.rating||0),0)/rows.length):0;

    $("advOfficialPlayers").textContent=official.length;
    $("advOfficialSub").textContent=`${rows.length} active players total`;
    $("advApprovedMatches").textContent=matchRows.length;
    $("advMatchesSub").textContent=statsScopeName();
    $("advAvgRating").textContent=rows.length?avg:"—";
    $("advTopRating").textContent=top?.rating??"—";
    $("advTopRatingName").textContent=top?.name||"—";

    if (!obj) {
      $("leagueAwardsGrid").innerHTML=`<div class="advanced-stats-loading">Loading awards, streaks, and achievements…</div>`;
      $("weeklyMovers").innerHTML=`<div class="advanced-stats-loading">Loading weekly movement…</div>`;
      $("achievementBoard").innerHTML=`<div class="advanced-stats-loading">Loading achievements…</div>`;
      $("advancedPlayerTableBody").innerHTML=`<tr><td colspan="8">Loading advanced stats…</td></tr>`;
      return;
    }

    const ctx=buildAdvancedContext(matchRows,obj);
    const upset=ctx.biggestUpset;
    const activeNames=playerNameList(ctx.mostActive.playerIds);
    const streakNames=playerNameList(ctx.longestStreak.playerIds);
    const giantNames=playerNameList(ctx.giantKiller.playerIds);
    const upsetNames=upset?playerNameList(upset.winnerIds):"—";

    $("leagueAwardsGrid").innerHTML=[
      awardCard("🔥","LONGEST WIN STREAK",streakNames,ctx.longestStreak.value?`${ctx.longestStreak.value} consecutive wins`:"No streak yet",ctx.longestStreak.playerIds),
      awardCard("💥","BIGGEST UPSET",upsetNames,upset?`Beat a team rated ${Math.round(upset.gap)} points higher on average • ${upset.match.score_a}-${upset.match.score_b}`:"No underdog wins yet",upset?.winnerIds||[]),
      awardCard("⚡","MOST ACTIVE",activeNames,ctx.mostActive.value?`${ctx.mostActive.value} approved games`:"No games yet",ctx.mostActive.playerIds),
      awardCard("👹","GIANT KILLER",giantNames,ctx.giantKiller.value?`${ctx.giantKiller.value} win${ctx.giantKiller.value===1?"":"s"} as a 75+ rating underdog`:"No major upset wins yet",ctx.giantKiller.playerIds)
    ].join("");

    renderWeeklyMovers(ctx);
    renderAchievementBoard(ctx);
    renderAdvancedPlayerTable(ctx);
  }

  async function loadAdvancedStatsData(force=false) {
    if (!$("leagueAwardsGrid")) return;
    const key=statsScopeKey();

    if (!configured) {
      advancedStatsCache.set(key,{results:[],tournamentResults:[],tournaments:[]});
      renderAdvancedStats();
      return;
    }
    if (!force && advancedStatsCache.has(key)) {
      renderAdvancedStats();
      return;
    }
    if (advancedStatsLoading) return;
    advancedStatsLoading=true;

    try {
      const results=[];
      const pageSize=1000;
      for (let from=0;from<10000;from+=pageSize) {
        let q=sb.from("match_player_results")
          .select("id,match_id,season_id,player_id,result,rating_before,rating_after,rating_delta,season_rating_before,season_rating_after,season_rating_delta,created_at")
          .order("created_at",{ascending:true})
          .range(from,from+pageSize-1);
        if (selectedSeasonId && selectedSeasonId!=="all") q=q.eq("season_id",selectedSeasonId);
        const {data,error}=await q;
        if (error) throw error;
        const page=data||[];
        results.push(...page);
        if (page.length<pageSize) break;
      }

      let tq=sb.from("tournaments")
        .select("id,season_id,name,status,champion_player_id,affects_ratings,created_at,completed_at")
        .order("created_at",{ascending:false});
      if (selectedSeasonId && selectedSeasonId!=="all") tq=tq.eq("season_id",selectedSeasonId);

      let trq=sb.from("tournament_rating_results")
        .select("id,tournament_id,tournament_match_id,season_id,player_id,result,rating_delta,season_rating_delta,created_at")
        .order("created_at",{ascending:true});
      if (selectedSeasonId && selectedSeasonId!=="all") trq=trq.eq("season_id",selectedSeasonId);

      const [tRes,trRes]=await Promise.all([tq,trq]);
      if (tRes.error) throw tRes.error;
      if (trRes.error) throw trRes.error;

      advancedStatsCache.set(key,{
        results,
        tournaments:tRes.data||[],
        tournamentResults:trRes.data||[]
      });
      renderAdvancedStats();
    } catch (err) {
      console.error(err);
      $("leagueAwardsGrid").innerHTML=`<div class="empty">Could not load advanced stats: ${esc(err.message||err)}</div>`;
    } finally {
      advancedStatsLoading=false;
    }
  }

  function activeMuteForUser(userId) {
    if (!userId) return null;
    const mute = chatMutes.find(m => m.user_id === userId);
    if (!mute) return null;
    if (!mute.muted_until) return mute;
    return new Date(mute.muted_until).getTime() > Date.now() ? mute : null;
  }

  function chatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" })
      : d.toLocaleDateString([], { month:"short", day:"numeric" }) + " • " +
        d.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  }

  function renderAnnouncements() {
    const list = $("announcementList");
    if (!list) return;
    list.innerHTML = announcements.length ? announcements.map(a => `
      <article class="announcement-card">
        <div class="announcement-pin">📌</div>
        <div class="announcement-copy">
          <div class="announcement-meta">
            <span>COMMISSIONER ANNOUNCEMENT</span>
            <time>${chatTime(a.created_at)}</time>
          </div>
          <h4>${esc(a.title)}</h4>
          <p>${esc(a.body).replace(/\n/g,"<br>")}</p>
          <small>Posted by ${esc(a.author_name || "Commissioner")}${a.expires_at ? ` • expires ${new Date(a.expires_at).toLocaleString()}` : ""}</small>
        </div>
        ${isCommissioner() ? `<button class="announcement-delete" data-delete-announcement="${a.id}" title="Delete announcement">×</button>` : ""}
      </article>
    `).join("") : `<div class="empty">No active commissioner announcements.</div>`;
  }

  function renderMuteManager() {
    const list = $("muteList");
    if (!list) return;
    const active = chatMutes.filter(m => !m.muted_until || new Date(m.muted_until).getTime() > Date.now());
    $("muteCountBadge").textContent = `${active.length} active`;
    list.innerHTML = active.length ? active.map(m => {
      const profile = profileById(m.user_id);
      const player = profile?.player_id ? playerById(profile.player_id) : null;
      const name = player?.name || profile?.full_name || "League account";
      const until = m.muted_until ? `Until ${new Date(m.muted_until).toLocaleString()}` : "Indefinite";
      return `<div class="mute-row">
        <div>
          <strong>${esc(name)}</strong>
          <span>${esc(until)}${m.reason ? ` • ${esc(m.reason)}` : ""}</span>
        </div>
        <button class="mini-compare-btn" data-unmute-user="${m.user_id}">Unmute</button>
      </div>`;
    }).join("") : `<div class="empty">No active chat mutes.</div>`;
  }

  function renderChatMessages() {
    const list = $("chatMessageList");
    if (!list) return;
    if (!currentUser) {
      list.innerHTML = `<div class="empty">Sign in to view league chat.</div>`;
      return;
    }
    if (!linkedPlayer() && !isCommissioner()) {
      list.innerHTML = `<div class="empty">Your roster identity must be approved before you can view player chat.</div>`;
      return;
    }
    list.innerHTML = communityMessages.length ? communityMessages.map(m => `
      <article class="chat-message ${m.author_role === "commissioner" ? "commissioner-message" : ""}">
        <div class="chat-avatar">${esc(initials(m.author_name))}</div>
        <div class="chat-message-main">
          <div class="chat-message-head">
            <strong>${esc(m.author_name)} <span class="verified-check">✓</span></strong>
            ${m.author_role === "commissioner" ? `<span class="commissioner-chat-badge">COMMISSIONER</span>` : ""}
            <time>${chatTime(m.created_at)}</time>
          </div>
          <div class="chat-message-body">${esc(m.body).replace(/\n/g,"<br>")}</div>
        </div>
        ${isCommissioner() ? `<div class="chat-mod-actions">
          <button data-delete-chat="${m.id}" title="Delete message">Delete</button>
          ${m.user_id !== currentUser?.id ? `<button data-mute-chat-user="${m.user_id}" data-mute-name="${esc(m.author_name)}" title="Mute player">Mute</button>` : ""}
        </div>` : ""}
      </article>
    `).join("") : `<div class="empty">No messages yet. Start the conversation.</div>`;

    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  function renderCommunity() {
    if (!$("community")) return;
    renderAnnouncements();
    renderChatMessages();
    renderMuteManager();

    $$(".chat-channel").forEach(btn => btn.classList.toggle("active", btn.dataset.chatChannel === activeChatChannel));
    const desc = activeChatChannel === "community"
      ? "General league conversation for verified XO players."
      : "Looking for a partner, opponents, or a fourth? Post it here.";
    $("chatChannelDescription").textContent = desc;
    $("chatInput").placeholder = activeChatChannel === "community"
      ? "Message #community…"
      : "Find a game… e.g. need a fourth tonight at 8";

    const access = $("chatAccessMessage");
    const send = $("sendChatBtn");
    const input = $("chatInput");
    const lp = linkedPlayer();
    const mute = activeMuteForUser(currentUser?.id);

    let accessText = "";
    if (!currentUser) {
      accessText = "Sign in to access league chat.";
    } else if (!lp && !isCommissioner()) {
      accessText = "Your player identity must be approved before you can read or send league chat messages.";
    } else if (mute) {
      accessText = mute.muted_until
        ? `Your chat access is muted until ${new Date(mute.muted_until).toLocaleString()}.`
        : "Your chat access is muted by the commissioner.";
      if (mute.reason) accessText += ` Reason: ${mute.reason}`;
    }

    access.classList.toggle("hidden", !accessText);
    access.textContent = accessText;

    const canSend = !!currentUser && (!!lp || isCommissioner()) && !mute && configured;
    send.disabled = !canSend;
    input.disabled = !canSend;
    send.style.opacity = canSend ? "1" : ".5";
    input.style.opacity = canSend ? "1" : ".65";
  }

  async function loadCommunityData(force=false) {
    if (!$("community") || !configured) {
      renderCommunity();
      return;
    }
    if (communityLoading) return;
    if (communityLoaded && !force) {
      renderCommunity();
      return;
    }

    communityLoading = true;
    try {
      const announcementPromise = sb.from("announcements")
        .select("*")
        .order("created_at", { ascending:false })
        .limit(10);

      let messagePromise = Promise.resolve({ data:[], error:null });
      let mutePromise = Promise.resolve({ data:[], error:null });

      if (currentUser && (linkedPlayer() || isCommissioner())) {
        messagePromise = sb.from("chat_messages")
          .select("*")
          .eq("channel", activeChatChannel)
          .order("created_at", { ascending:false })
          .limit(100);
        mutePromise = sb.from("chat_mutes")
          .select("*")
          .order("muted_at", { ascending:false });
      }

      const [aRes, mRes, muteRes] = await Promise.all([announcementPromise, messagePromise, mutePromise]);

      if (aRes.error) throw aRes.error;
      announcements = aRes.data || [];

      if (!mRes.error) communityMessages = [...(mRes.data || [])].reverse();
      else communityMessages = [];

      if (!muteRes.error) chatMutes = muteRes.data || [];
      else chatMutes = [];

      communityLoaded = true;
      renderCommunity();
    } catch (err) {
      console.error(err);
      setMessage($("chatSendMessage"), `Community load error: ${err.message || err}`, "error");
    } finally {
      communityLoading = false;
    }
  }

  async function sendChatMessage() {
    const body = $("chatInput").value.trim();
    if (!body) return;
    if (body.length > 500) return setMessage($("chatSendMessage"), "Message is too long.", "error");
    if (!linkedPlayer() && !isCommissioner()) return setMessage($("chatSendMessage"), "Verified player identity required.", "error");

    $("sendChatBtn").disabled = true;
    const { error } = await sb.rpc("send_chat_message", {
      p_channel: activeChatChannel,
      p_body: body
    });
    $("sendChatBtn").disabled = false;

    if (error) return setMessage($("chatSendMessage"), error.message, "error");
    $("chatInput").value = "";
    $("chatCharCount").textContent = "0 / 500";
    setMessage($("chatSendMessage"), "");
    communityLoaded = false;
    await loadCommunityData(true);
  }

  async function deleteChatMessage(messageId) {
    if (!isCommissioner()) return;
    if (!confirm("Delete this chat message?")) return;
    const { error } = await sb.rpc("commissioner_delete_chat_message", { p_message_id:messageId });
    if (error) return alert(error.message);
    communityLoaded = false;
    await loadCommunityData(true);
  }

  async function muteChatUser(userId, displayName) {
    if (!isCommissioner()) return;
    const hoursRaw = prompt(`Mute ${displayName} for how many hours?\n\nUse 0 for an indefinite mute.`, "24");
    if (hoursRaw === null) return;
    const hours = Number(hoursRaw);
    if (!Number.isInteger(hours) || hours < 0 || hours > 720) {
      return alert("Enter a whole number from 0 to 720.");
    }
    const reason = prompt("Optional reason for the mute:", "") ?? "";
    const { error } = await sb.rpc("commissioner_mute_chat_user", {
      p_user_id:userId,
      p_hours:hours,
      p_reason:reason
    });
    if (error) return alert(error.message);
    communityLoaded = false;
    await loadCommunityData(true);
  }

  async function unmuteChatUser(userId) {
    if (!isCommissioner()) return;
    const { error } = await sb.rpc("commissioner_unmute_chat_user", { p_user_id:userId });
    if (error) return alert(error.message);
    communityLoaded = false;
    await loadCommunityData(true);
  }

  async function postAnnouncement() {
    if (!isCommissioner()) return;
    const title = $("announcementTitle").value.trim();
    const body = $("announcementBody").value.trim();
    const expiry = $("announcementExpiry").value;

    if (title.length < 3) return setMessage($("announcementMessage"), "Give the announcement a title.", "error");
    if (!body) return setMessage($("announcementMessage"), "Write the announcement.", "error");

    let expiresAt = null;
    if (expiry !== "none") expiresAt = new Date(Date.now() + Number(expiry) * 3600000).toISOString();

    $("postAnnouncementBtn").disabled = true;
    const { error } = await sb.rpc("commissioner_post_announcement", {
      p_title:title,
      p_body:body,
      p_expires_at:expiresAt
    });
    $("postAnnouncementBtn").disabled = false;

    if (error) return setMessage($("announcementMessage"), error.message, "error");
    $("announcementTitle").value = "";
    $("announcementBody").value = "";
    $("announcementCount").textContent = "0 / 1000";
    setMessage($("announcementMessage"), "Announcement posted.", "success");
    communityLoaded = false;
    await loadCommunityData(true);
  }

  async function deleteAnnouncement(id) {
    if (!isCommissioner()) return;
    if (!confirm("Delete this announcement?")) return;
    const { error } = await sb.rpc("commissioner_delete_announcement", { p_announcement_id:id });
    if (error) return alert(error.message);
    communityLoaded = false;
    await loadCommunityData(true);
  }


  function tournamentById(id) {
    return tournaments.find(t => t.id === id);
  }

  function entriesForTournament(id) {
    return tournamentEntries.filter(e => e.tournament_id === id).sort((a,b) => a.seed-b.seed);
  }

  function matchesForTournament(id) {
    return tournamentMatches.filter(m => m.tournament_id === id)
      .sort((a,b) => a.round_number-b.round_number || a.match_number-b.match_number);
  }

  function tournamentSeedMap(id) {
    return Object.fromEntries(entriesForTournament(id).map(e => [e.player_id, e.seed]));
  }

  function tournamentRoundLabel(t, round) {
    const rounds = Math.log2(Number(t.size));
    if (round === rounds) return "Final";
    if (round === rounds - 1) return "Semifinals";
    if (round === rounds - 2) return "Quarterfinals";
    const remaining = Number(t.size) / Math.pow(2, round - 1);
    return `Round of ${remaining}`;
  }

  function tournamentStatusText(t) {
    return t.status === "completed" ? "Completed" : "Live";
  }

  function renderTournamentBuilder() {
    if (!$("tournamentPlayerPicker")) return;
    const s = activeSeason();
    $("tournamentSeasonBadge").textContent = s?.name || "No active season";

    const size = Number($("tournamentSize")?.value || 8);
    const q = ($("tournamentPlayerSearch")?.value || "").trim().toLowerCase();
    const roster = activeSeasonRows();
    const visible = roster.filter(p => p.name.toLowerCase().includes(q));

    // If a removed/inactive id somehow remains selected, discard it.
    const valid = new Set(roster.map(p => p.id));
    tournamentEntrantSelection = new Set([...tournamentEntrantSelection].filter(id => valid.has(id)));

    $("tournamentSelectedCount").textContent = `${tournamentEntrantSelection.size} / ${size} selected`;
    $("autoFillTournamentBtn").textContent = `Auto-fill Top ${size}`;
    $("createTournamentBtn").disabled = tournamentEntrantSelection.size !== size || !s;

    $("tournamentPlayerPicker").innerHTML = visible.map((p, idx) => {
      const rank = roster.findIndex(x => x.id === p.id) + 1;
      const checked = tournamentEntrantSelection.has(p.id);
      return `<label class="tournament-player-pick ${checked ? "selected" : ""}">
        <input type="checkbox" data-tournament-player="${p.id}" ${checked ? "checked" : ""} />
        <span class="tournament-pick-seed">${p.provisional ? "PROV" : `#${rank}`}</span>
        <span class="tournament-pick-name">${esc(p.name)}</span>
        <b>${p.rating}</b>
      </label>`;
    }).join("") || `<div class="empty">No players found.</div>`;
  }

  function renderTournamentList() {
    if (!$("tournamentList")) return;
    const live = tournaments.filter(t => t.status === "live").length;
    $("liveTournamentCount").textContent = `${live} live`;

    $("tournamentList").innerHTML = tournaments.length ? tournaments.map(t => {
      const champ = t.champion_player_id ? playerById(t.champion_player_id)?.name : null;
      return `<button class="tournament-list-card ${t.id === selectedTournamentId ? "active" : ""}" data-tournament-select="${t.id}">
        <div class="tournament-list-top">
          <span class="tournament-status ${t.status}">${tournamentStatusText(t)}</span>
          <small>${t.size}-player</small>
        </div>
        <strong>${esc(t.name)}</strong>
        <span>${esc(seasonById(t.season_id)?.name || "Season")} • ${t.affects_ratings ? "Elo ON" : "Exhibition"}</span>
        ${champ ? `<em>Champion: ${esc(champ)}</em>` : ""}
      </button>`;
    }).join("") : `<div class="empty">No tournaments yet.</div>`;
  }

  function ratingDeltaForTournamentMatch(matchId, playerId) {
    const r = tournamentRatingResults.find(x => x.tournament_match_id === matchId && x.player_id === playerId);
    if (!r) return null;
    return selectedSeasonId === "all" ? Number(r.rating_delta) : Number(r.season_rating_delta);
  }

  function renderTournamentMatchCard(t, m, seedMap) {
    const p1 = m.player1_id ? playerById(m.player1_id) : null;
    const p2 = m.player2_id ? playerById(m.player2_id) : null;
    const p1Winner = m.winner_player_id && m.winner_player_id === m.player1_id;
    const p2Winner = m.winner_player_id && m.winner_player_id === m.player2_id;
    const ready = m.status === "ready" && p1 && p2;
    const delta1 = t.affects_ratings && m.status === "completed" ? ratingDeltaForTournamentMatch(m.id, m.player1_id) : null;
    const delta2 = t.affects_ratings && m.status === "completed" ? ratingDeltaForTournamentMatch(m.id, m.player2_id) : null;

    const playerLine = (p, winner, score, delta) => `
      <div class="bracket-player ${winner ? "winner" : ""} ${!p ? "tbd" : ""}">
        <span class="bracket-seed">${p ? (seedMap[p.id] || "—") : "—"}</span>
        <strong>${p ? esc(p.name) : "TBD"}</strong>
        ${delta !== null ? `<small class="${delta >= 0 ? "positive" : "negative"}">${delta >= 0 ? "+" : ""}${delta}</small>` : ""}
        <b>${score ?? "—"}</b>
      </div>`;

    return `<article class="bracket-match ${m.status}">
      <div class="bracket-match-number">Match ${m.match_number}</div>
      ${playerLine(p1, p1Winner, m.status === "completed" ? m.score1 : null, delta1)}
      ${playerLine(p2, p2Winner, m.status === "completed" ? m.score2 : null, delta2)}
      <div class="bracket-match-footer">
        ${m.status === "completed"
          ? `<span>Final</span>`
          : ready
            ? `<span>Ready to play</span>${isCommissioner() ? `<button data-tournament-result="${m.id}">Enter result</button>` : ""}`
            : `<span>Waiting for previous round</span>`}
      </div>
    </article>`;
  }

  function renderTournamentDetail() {
    const root = $("tournamentDetail");
    if (!root) return;
    const t = tournamentById(selectedTournamentId);
    if (!t) {
      root.innerHTML = `<div class="empty tournament-empty"><strong>No tournament selected.</strong><span>When Ori creates a bracket, it will appear here.</span></div>`;
      return;
    }

    const entries = entriesForTournament(t.id);
    const rows = matchesForTournament(t.id);
    const seedMap = tournamentSeedMap(t.id);
    const rounds = [...new Set(rows.map(m => m.round_number))];
    const champion = t.champion_player_id ? playerById(t.champion_player_id) : null;

    root.innerHTML = `
      <div class="tournament-detail-head">
        <div>
          <div class="panel-kicker">${esc(seasonById(t.season_id)?.name || "SEASON")} • ${t.size} PLAYER BRACKET</div>
          <h2>${esc(t.name)}</h2>
          <div class="tournament-detail-meta">
            <span class="tournament-status ${t.status}">${tournamentStatusText(t)}</span>
            <span>${t.affects_ratings ? "⚡ Elo enabled" : "Exhibition — no rating impact"}</span>
            <span>Started ${new Date(t.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        ${champion ? `<div class="champion-chip"><span>♛</span><div><small>CHAMPION</small><strong>${esc(champion.name)}</strong></div></div>` : ""}
      </div>

      ${champion ? `<div class="champion-banner"><span>♛</span><div><small>${esc(t.name)} CHAMPION</small><strong>${esc(champion.name)}</strong></div></div>` : ""}

      <div class="bracket-scroll">
        <div class="bracket-board rounds-${rounds.length}">
          ${rounds.map(round => `
            <section class="bracket-round">
              <div class="bracket-round-head">
                <span>ROUND ${round}</span>
                <strong>${tournamentRoundLabel(t, round)}</strong>
              </div>
              <div class="bracket-round-matches">
                ${rows.filter(m => m.round_number === round).map(m => renderTournamentMatchCard(t, m, seedMap)).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      </div>

      <div class="seed-list">
        <div class="panel-kicker">ORIGINAL SEEDS</div>
        <div class="seed-grid">
          ${entries.map(e => `<button data-player-profile="${e.player_id}"><b>#${e.seed}</b><span>${esc(playerById(e.player_id)?.name || "Unknown")}</span></button>`).join("")}
        </div>
      </div>`;
  }

  function renderChampionHistory() {
    const root = $("championHistory");
    if (!root) return;
    const completed = tournaments.filter(t => t.status === "completed" && t.champion_player_id)
      .sort((a,b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at));

    root.innerHTML = completed.length ? completed.map(t => {
      const champ = playerById(t.champion_player_id);
      return `<article class="champion-history-card" data-tournament-select="${t.id}">
        <div class="champion-history-crown">♛</div>
        <div>
          <span>${esc(seasonById(t.season_id)?.name || "Season")} • ${t.size} players</span>
          <strong>${esc(t.name)}</strong>
          <b>${esc(champ?.name || "Champion")}</b>
        </div>
        <small>${t.completed_at ? new Date(t.completed_at).toLocaleDateString() : ""}<br>${t.affects_ratings ? "Elo event" : "Exhibition"}</small>
      </article>`;
    }).join("") : `<div class="empty">No champions yet.</div>`;
  }

  function renderTournamentHub() {
    if (!$("tournaments")) return;
    renderTournamentBuilder();
    renderTournamentList();
    renderTournamentDetail();
    renderChampionHistory();
  }

  async function loadTournamentData(force=false) {
    if (!$("tournaments") || !configured) {
      renderTournamentHub();
      return;
    }
    if (tournamentLoading) return;
    if (tournamentLoaded && !force) {
      renderTournamentHub();
      return;
    }

    tournamentLoading = true;
    try {
      const [tRes, eRes, mRes, rRes] = await Promise.all([
        sb.from("tournaments").select("*").order("created_at", { ascending:false }).limit(50),
        sb.from("tournament_entries").select("*").order("seed", { ascending:true }),
        sb.from("tournament_matches").select("*").order("round_number", { ascending:true }),
        sb.from("tournament_rating_results").select("*").order("created_at", { ascending:true })
      ]);

      if (tRes.error) throw tRes.error;
      if (eRes.error) throw eRes.error;
      if (mRes.error) throw mRes.error;
      if (rRes.error) throw rRes.error;

      tournaments = tRes.data || [];
      tournamentEntries = eRes.data || [];
      tournamentMatches = mRes.data || [];
      tournamentRatingResults = rRes.data || [];

      if (!selectedTournamentId || !tournamentById(selectedTournamentId)) {
        selectedTournamentId = tournaments.find(t => t.status === "live")?.id || tournaments[0]?.id || null;
      }

      tournamentLoaded = true;
      renderTournamentHub();
    } catch (err) {
      console.error(err);
      $("tournamentDetail").innerHTML = `<div class="empty tournament-empty"><strong>Could not load tournaments.</strong><span>${esc(err.message || err)}</span></div>`;
    } finally {
      tournamentLoading = false;
    }
  }

  function autoFillTournament() {
    const size = Number($("tournamentSize").value || 8);
    tournamentEntrantSelection = new Set(activeSeasonRows().slice(0,size).map(p => p.id));
    renderTournamentBuilder();
  }

  function clearTournamentSelection() {
    tournamentEntrantSelection.clear();
    renderTournamentBuilder();
  }

  function toggleTournamentEntrant(playerId, checked) {
    const size = Number($("tournamentSize").value || 8);
    if (checked) {
      if (tournamentEntrantSelection.size >= size) {
        const box = document.querySelector(`[data-tournament-player="${playerId}"]`);
        if (box) box.checked = false;
        return setMessage($("tournamentCreateMessage"), `This bracket only has ${size} spots.`, "error");
      }
      tournamentEntrantSelection.add(playerId);
    } else {
      tournamentEntrantSelection.delete(playerId);
    }
    setMessage($("tournamentCreateMessage"), "");
    renderTournamentBuilder();
  }

  async function createTournament() {
    if (!isCommissioner()) return;
    const name = $("tournamentName").value.trim();
    const size = Number($("tournamentSize").value);
    const affects = $("tournamentAffectsElo").checked;
    const ids = [...tournamentEntrantSelection];

    if (name.length < 3) return setMessage($("tournamentCreateMessage"), "Enter a tournament name.", "error");
    if (ids.length !== size) return setMessage($("tournamentCreateMessage"), `Select exactly ${size} players.`, "error");

    const warning = affects
      ? `Create "${name}" with ${size} players?\n\nSeeding is automatic from the active season rankings.\n\nTOURNAMENT ELO IS ON: each completed bracket match will change player ratings and uncertainty. It will NOT change normal doubles W-L records or provisional match counts.`
      : `Create "${name}" with ${size} players?\n\nSeeding is automatic from the active season rankings.\n\nThis is an exhibition bracket: tournament results will NOT change ratings.`;

    if (!confirm(warning)) return;

    $("createTournamentBtn").disabled = true;
    const { data, error } = await sb.rpc("commissioner_create_tournament", {
      p_name:name,
      p_size:size,
      p_affects_ratings:affects,
      p_player_ids:ids
    });
    $("createTournamentBtn").disabled = false;

    if (error) return setMessage($("tournamentCreateMessage"), error.message, "error");

    $("tournamentName").value = "";
    tournamentEntrantSelection.clear();
    selectedTournamentId = data;
    tournamentLoaded = false;
    setMessage($("tournamentCreateMessage"), "Tournament created and seeded.", "success");
    await loadTournamentData(true);
  }

  function openTournamentResult(matchId) {
    const m = tournamentMatches.find(x => x.id === matchId);
    const t = m ? tournamentById(m.tournament_id) : null;
    if (!m || !t || m.status !== "ready") return;

    tournamentResultMatchId = matchId;
    const p1 = playerById(m.player1_id);
    const p2 = playerById(m.player2_id);

    $("tournamentResultTitle").textContent = `${t.name} • ${tournamentRoundLabel(t,m.round_number)}`;
    $("resultPlayer1Label").textContent = p1?.name || "Player 1";
    $("resultPlayer2Label").textContent = p2?.name || "Player 2";
    $("tournamentResultMatchup").innerHTML = `<strong>${esc(p1?.name || "TBD")}</strong><span>vs</span><strong>${esc(p2?.name || "TBD")}</strong>`;
    $("tournamentScore1").value = 11;
    $("tournamentScore2").value = 0;
    $("tournamentEloWarning").classList.toggle("hidden", !t.affects_ratings);
    $("tournamentEloWarning").textContent = t.affects_ratings
      ? "Elo is ON for this event. Saving this result immediately changes both players’ career and season ratings."
      : "";
    setMessage($("tournamentResultMessage"), "");
    $("tournamentResultModal").classList.remove("hidden");
  }

  function closeTournamentResult() {
    tournamentResultMatchId = null;
    $("tournamentResultModal").classList.add("hidden");
    setMessage($("tournamentResultMessage"), "");
  }

  async function saveTournamentResult() {
    if (!isCommissioner() || !tournamentResultMatchId) return;
    const score1 = Number($("tournamentScore1").value);
    const score2 = Number($("tournamentScore2").value);

    if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1 < 0 || score2 < 0 || score1 === score2 || score1 > 99 || score2 > 99) {
      return setMessage($("tournamentResultMessage"), "Enter a valid non-tied score from 0-99.", "error");
    }

    const m = tournamentMatches.find(x => x.id === tournamentResultMatchId);
    const p1 = playerById(m?.player1_id);
    const p2 = playerById(m?.player2_id);
    const winner = score1 > score2 ? p1 : p2;

    if (!confirm(`Save ${p1?.name || "Player 1"} ${score1} - ${score2} ${p2?.name || "Player 2"}?\n\nWinner: ${winner?.name || "Unknown"}\nThis cannot be edited from the tournament screen after saving.`)) return;

    $("saveTournamentResultBtn").disabled = true;
    const { error } = await sb.rpc("commissioner_record_tournament_result", {
      p_match_id:tournamentResultMatchId,
      p_score1:score1,
      p_score2:score2
    });
    $("saveTournamentResultBtn").disabled = false;

    if (error) return setMessage($("tournamentResultMessage"), error.message, "error");

    closeTournamentResult();
    tournamentLoaded = false;
    playerProfileCache.clear();
    await Promise.all([loadData(), loadTournamentData(true)]);
  }

  function renderHistory() {
    const approved = matches.filter(m => m.status === "approved").slice(0, 30);
    $("historyList").innerHTML = approved.length ? approved.map(m => {
      const n = matchNames(m);
      return `<article class="match-card">
        <strong>${esc(n.teamA)} <span style="color:#6f7885">vs</span> ${esc(n.teamB)}</strong>
        <small>${esc(seasonNameForMatch(m))} • ${m.score_a}-${m.score_b} • uncertainty-weighted rating update • ${new Date(m.reviewed_at || m.created_at).toLocaleString()}</small>
      </article>`;
    }).join("") : `<div class="empty">No approved matches yet.</div>`;
  }

  function renderAuth() {
    const signed = !!currentUser;
    const lp = linkedPlayer();
    $("loginBtn").classList.toggle("hidden", signed);
    $("logoutBtn").classList.toggle("hidden", !signed);
    $("accountChip").classList.toggle("hidden", !signed);
    $("accountChip").textContent = signed
      ? `${lp?.name || myProfile?.full_name || currentUser.email}${isCommissioner() ? " • COMMISSIONER" : lp ? " • VERIFIED" : " • UNVERIFIED"}`
      : "";
    $$(".commissioner-only").forEach(el => el.classList.toggle("hidden", !isCommissioner()));
    $$(".member-only").forEach(el => el.classList.toggle("hidden", !signed));
    $("loginNeeded").classList.toggle("hidden", signed);
    $("submitMatchBtn").disabled = !signed || !configured || !lp;
    $("submitMatchBtn").style.opacity = (!signed || !configured || !lp) ? ".5" : "1";
    renderIdentity();
  }

  function renderCommissionerGate() {
    $("commissionerDenied").classList.toggle("hidden", isCommissioner());
    $("commissionerContent").classList.toggle("hidden", !isCommissioner());
    if (isCommissioner()) {
      renderClaimQueue();
      renderPending();
      renderHistory();
      renderAudit();
    }
  }

  function renderAll() {
    renderSeasonControls();
    renderLeaderboard();
    renderStatsHub();
    renderCommunity();
    renderTournamentHub();
    renderSelects();
    renderAuth();
    renderMyMatches();
    renderCommissionerGate();
  }

  async function loadData() {
    if (!configured) {
      const base = 1700, step = 8;
      players = SEED_PLAYERS.map((name,i) => ({
        id:`demo-${i+1}`, name, rating:base-i*step, wins:0, losses:0, previous_rank:i+1,
        rating_deviation:120, provisional:false, active:true
      }));
      matches = [];
      identityClaims = [];
      claimStatus = [];
      profiles = [];
      auditLogs = [];
      seasons = [{ id:"demo-season", name:"Fall 2026", slug:"fall-2026", status:"active", starting_mode:"carry" }];
      seasonStats = players.map(p => ({
        season_id:"demo-season", player_id:p.id, rating:p.rating, rating_deviation:p.rating_deviation,
        wins:p.wins, losses:p.losses, provisional:p.provisional, previous_rank:p.previous_rank,
        peak_rating:p.rating, active:true
      }));
      selectedSeasonId = "demo-season";
      $("syncStatus").textContent = "Preview mode";
      $("syncStatus").classList.remove("live");
      const banner = $("modeBanner");
      banner.classList.remove("hidden");
      banner.textContent = "Preview mode: connect Supabase to enable verified identities, confirmations, and commissioner audit logs.";
      renderAll();
      return;
    }

    const basePromises = [
      sb.from("players").select("*").order("rating", { ascending:false }),
      sb.from("matches").select("*").order("created_at", { ascending:false }).limit(250),
      sb.from("seasons").select("*").order("starts_on", { ascending:false }),
      sb.from("season_player_stats").select("*")
    ];
    const [pRes, mRes, sRes, ssRes] = await Promise.all(basePromises);
    if (pRes.error) throw pRes.error;
    if (mRes.error) throw mRes.error;
    if (sRes.error) throw sRes.error;
    if (ssRes.error) throw ssRes.error;
    players = pRes.data || [];
    matches = mRes.data || [];
    seasons = sRes.data || [];
    seasonStats = ssRes.data || [];
    playerProfileCache.clear();
    statsMatchesCache.clear();
    advancedStatsCache.clear();
    communityLoaded = false;
    if (!selectedSeasonId) selectedSeasonId = activeSeason()?.id || "all";

    identityClaims = [];
    claimStatus = [];
    profiles = myProfile ? [myProfile] : [];
    auditLogs = [];

    if (currentUser) {
      const [claimsRes, claimStatusRes] = await Promise.all([
        sb.from("identity_claims").select("*").order("created_at", { ascending:false }).limit(200),
        sb.rpc("list_player_claim_status")
      ]);
      if (!claimsRes.error) identityClaims = claimsRes.data || [];
      if (!claimStatusRes.error) claimStatus = claimStatusRes.data || [];

      if (isCommissioner()) {
        const [profilesRes, auditRes] = await Promise.all([
          sb.from("profiles").select("id,full_name,role,player_id").order("full_name"),
          sb.from("audit_log").select("*").order("created_at", { ascending:false }).limit(100)
        ]);
        if (!profilesRes.error) profiles = profilesRes.data || [];
        if (!auditRes.error) auditLogs = auditRes.data || [];
      }
    }

    $("syncStatus").textContent = "Live";
    $("syncStatus").classList.add("live");
    renderAll();
  }

  async function refreshProfile() {
    if (!configured || !currentUser) {
      myProfile = null;
      renderAuth();
      return;
    }
    const { data, error } = await sb.from("profiles").select("id,full_name,role,player_id").eq("id", currentUser.id).maybeSingle();
    if (!error) myProfile = data;
    renderAll();
  }

  async function initAuth() {
    if (!configured) {
      currentUser = null;
      myProfile = null;
      renderAuth();
      return;
    }
    const { data } = await sb.auth.getSession();
    currentUser = data.session?.user || null;
    await refreshProfile();

    sb.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session?.user || null;
      await refreshProfile();
      await loadData();
    });
  }

  function openAuth(mode="signin") {
    authMode = mode;
    $("authModal").classList.remove("hidden");
    updateAuthModal();
    setTimeout(() => $("authEmail").focus(), 0);
  }

  function closeAuth() {
    $("authModal").classList.add("hidden");
    setMessage($("authMessage"), "");
  }

  function updateAuthModal() {
    const signup = authMode === "signup";
    $("authTitle").textContent = signup ? "Create league account" : "Sign in";
    $("authSubmit").textContent = signup ? "Create account" : "Sign in";
    $("authSwitch").textContent = signup ? "Already have an account? Sign in" : "Need an account? Sign up";
    $("nameField").classList.toggle("hidden", !signup);
  }

  async function submitAuth() {
    if (!configured) return setMessage($("authMessage"), "Connect Supabase first using the setup guide.", "error");
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const fullName = $("authName").value.trim();
    if (!email || password.length < 8 || (authMode === "signup" && !fullName)) {
      return setMessage($("authMessage"), "Enter a valid email, an 8+ character password, and your name.", "error");
    }

    $("authSubmit").disabled = true;
    const result = authMode === "signup"
      ? await sb.auth.signUp({ email, password, options:{ data:{ full_name:fullName } } })
      : await sb.auth.signInWithPassword({ email, password });
    $("authSubmit").disabled = false;

    if (result.error) return setMessage($("authMessage"), result.error.message, "error");
    if (authMode === "signup" && !result.data.session) {
      return setMessage($("authMessage"), "Account created. Check your email to confirm it, then sign in.", "success");
    }
    closeAuth();
  }

  async function requestIdentity() {
    if (!currentUser) return openAuth("signin");
    const playerId = $("claimPlayerSelect").value;
    if (!playerId) return setMessage($("claimMessage"), "Choose your real roster name.", "error");
    $("claimPlayerBtn").disabled = true;
    const { error } = await sb.rpc("request_player_claim", { p_player_id:playerId });
    $("claimPlayerBtn").disabled = false;
    if (error) return setMessage($("claimMessage"), error.message, "error");
    setMessage($("claimMessage"), "Identity request sent to Ori.", "success");
    await loadData();
  }

  async function reviewIdentityClaim(id, decision) {
    if (!isCommissioner()) return;
    const buttons = $$(`[data-claim-review="${id}"]`);
    buttons.forEach(b => b.disabled = true);
    const { error } = await sb.rpc("review_player_claim", { p_claim_id:id, p_decision:decision });
    if (error) {
      alert(error.message);
      buttons.forEach(b => b.disabled = false);
      return;
    }
    await refreshProfile();
    await loadData();
  }

  async function unlinkIdentity() {
    if (!isCommissioner()) return;
    const playerId = $("unlinkPlayer").value;
    if (!playerId) return setMessage($("adminMessage"), "Choose a linked player first.", "error");
    const p = playerById(playerId);
    if (!confirm(`Unlink ${p?.name || "this player"} from their account?`)) return;
    const { error } = await sb.rpc("commissioner_unlink_player", { p_player_id:playerId });
    if (error) return setMessage($("adminMessage"), error.message, "error");
    setMessage($("adminMessage"), "Identity link removed.", "success");
    await loadData();
  }

  async function submitMatch() {
    if (!configured) return setMessage($("submitMessage"), "Connect Supabase before submitting real scores.", "error");
    if (!currentUser) return openAuth("signin");
    const lp = linkedPlayer();
    if (!lp) return setMessage($("submitMessage"), "Your player identity must be approved first.", "error");

    const ids = ["a1","a2","b1","b2"].map(id => $(id).value);
    const scoreA = Number($("scoreA").value);
    const scoreB = Number($("scoreB").value);
    if (ids.some(x => !x)) return setMessage($("submitMessage"), "Choose all four players.", "error");
    if (new Set(ids).size !== 4) return setMessage($("submitMessage"), "Each player can only appear once.", "error");
    if (!ids.includes(lp.id)) return setMessage($("submitMessage"), `You are verified as ${lp.name}, so you must be one of the four players.`, "error");
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA === scoreB)
      return setMessage($("submitMessage"), "Enter a valid non-tied score.", "error");

    $("submitMatchBtn").disabled = true;
    const { error } = await sb.rpc("submit_match", {
      p_a1:ids[0], p_a2:ids[1], p_b1:ids[2], p_b2:ids[3], p_score_a:scoreA, p_score_b:scoreB
    });
    $("submitMatchBtn").disabled = false;
    if (error) return setMessage($("submitMessage"), error.message, "error");
    setMessage($("submitMessage"), `Submitted to ${activeSeason()?.name || "the active season"}. Someone from the opposing team must confirm it before Ori sees it for final approval.`, "success");
    await loadData();
  }

  async function confirmMatch(id) {
    const { error } = await sb.rpc("confirm_match", { p_match_id:id });
    if (error) return alert(error.message);
    await loadData();
  }

  async function disputeMatch(id) {
    const input = document.querySelector(`[data-dispute-input="${id}"]`);
    const reason = input?.value?.trim() || "";
    if (reason.length < 3) {
      if (input) input.focus();
      return;
    }
    const { error } = await sb.rpc("dispute_match", { p_match_id:id, p_reason:reason });
    if (error) return alert(error.message);
    await loadData();
  }

  async function reviewMatch(id, decision) {
    if (!isCommissioner()) return;
    const buttons = $$(`[data-review="${id}"]`);
    buttons.forEach(b => b.disabled = true);
    const { error } = await sb.rpc("review_match", { p_match_id:id, p_decision:decision });
    if (error) {
      alert(error.message);
      buttons.forEach(b => b.disabled = false);
      return;
    }
    await loadData();
  }

  async function addPlayer() {
    if (!isCommissioner()) return;
    const name = $("newPlayerName").value.trim();
    const rating = Math.round(Number($("newPlayerRating").value));
    if (!name || !Number.isFinite(rating)) return setMessage($("adminMessage"), "Enter a player name and rating.", "error");
    const { error } = await sb.rpc("commissioner_add_player", { p_name:name, p_rating:rating });
    if (error) return setMessage($("adminMessage"), error.message, "error");
    $("newPlayerName").value = "";
    setMessage($("adminMessage"), `${name} added as a provisional player.`, "success");
    await loadData();
  }

  async function setRating() {
    if (!isCommissioner()) return;
    const id = $("editPlayer").value;
    const rating = Math.round(Number($("editRating").value));
    if (!id || !Number.isFinite(rating)) return setMessage($("adminMessage"), "Choose a player and rating.", "error");
    const { error } = await sb.rpc("commissioner_set_rating", { p_player_id:id, p_rating:rating });
    if (error) return setMessage($("adminMessage"), error.message, "error");
    setMessage($("adminMessage"), "Rating updated and logged.", "success");
    await loadData();
  }

  async function createSeason() {
    if (!isCommissioner()) return;
    const name = $("newSeasonName").value.trim();
    const mode = $("newSeasonMode").value;
    if (name.length < 3) return setMessage($("seasonAdminMessage"), "Enter a season name, like Spring 2027.", "error");

    const current = activeSeason();
    const modeText = mode === "fresh"
      ? "Everyone starts this season at 1500 with high uncertainty."
      : "Ratings carry into the new season, but season W-L resets to 0-0.";

    const warning = current
      ? `Start "${name}" and archive ${current.name}?\n\n${modeText}\n\nOld season standings and match history stay saved.`
      : `Start "${name}"?\n\n${modeText}`;

    if (!confirm(warning)) return;

    $("createSeasonBtn").disabled = true;
    const { data, error } = await sb.rpc("commissioner_create_season", { p_name:name, p_mode:mode });
    $("createSeasonBtn").disabled = false;

    if (error) return setMessage($("seasonAdminMessage"), error.message, "error");
    $("newSeasonName").value = "";
    selectedSeasonId = data || null;
    setMessage($("seasonAdminMessage"), `${name} is now the active season.`, "success");
    await loadData();
  }

  function subscribeRealtime() {
    if (!configured) return;
    if (realtimeChannel) sb.removeChannel(realtimeChannel);
    realtimeChannel = sb.channel("xo-league-live-v8")
      .on("postgres_changes", { event:"*", schema:"public", table:"players" }, () => loadData())
      .on("postgres_changes", { event:"*", schema:"public", table:"matches" }, async () => {
        await loadData();
        if ($("stats")?.classList.contains("active")) {
          await loadStatsMatches(true);
          await loadAdvancedStatsData(true);
        }
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"match_player_results" }, () => {
        advancedStatsCache.clear();
        playerProfileCache.clear();
        if ($("stats")?.classList.contains("active")) loadAdvancedStatsData(true);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"identity_claims" }, async () => { await refreshProfile(); await loadData(); })
      .on("postgres_changes", { event:"*", schema:"public", table:"audit_log" }, () => { if (isCommissioner()) loadData(); })
      .on("postgres_changes", { event:"*", schema:"public", table:"seasons" }, () => loadData())
      .on("postgres_changes", { event:"*", schema:"public", table:"season_player_stats" }, () => loadData())
      .on("postgres_changes", { event:"*", schema:"public", table:"chat_messages" }, () => {
        communityLoaded = false;
        if ($("community")?.classList.contains("active")) loadCommunityData(true);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"announcements" }, () => {
        communityLoaded = false;
        if ($("community")?.classList.contains("active")) loadCommunityData(true);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"chat_mutes" }, () => {
        communityLoaded = false;
        if ($("community")?.classList.contains("active")) loadCommunityData(true);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"tournaments" }, () => {
        tournamentLoaded = false;
        advancedStatsCache.clear();
        if ($("tournaments")?.classList.contains("active")) loadTournamentData(true);
        if ($("stats")?.classList.contains("active")) loadAdvancedStatsData(true);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"tournament_matches" }, () => {
        tournamentLoaded = false;
        if ($("tournaments")?.classList.contains("active")) loadTournamentData(true);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"tournament_entries" }, () => {
        tournamentLoaded = false;
        if ($("tournaments")?.classList.contains("active")) loadTournamentData(true);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"tournament_rating_results" }, () => {
        tournamentLoaded = false;
        advancedStatsCache.clear();
        if ($("tournaments")?.classList.contains("active")) loadTournamentData(true);
        if ($("stats")?.classList.contains("active")) loadAdvancedStatsData(true);
      })
      .subscribe();
  }

  function wireEvents() {
    $$(".nav-btn").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
    $$('[data-go]').forEach(b => b.addEventListener("click", () => setView(b.dataset.go)));
    $("playerSearch").addEventListener("input", renderLeaderboard);
    $("seasonSelect").addEventListener("change", e => {
      selectedSeasonId = e.target.value;
      renderAll();
      if ($("stats").classList.contains("active")) {
        loadStatsMatches();
        loadAdvancedStatsData();
      }
    });

    $("statsSeasonSelect").addEventListener("change", e => {
      selectedSeasonId = e.target.value;
      renderAll();
      loadStatsMatches();
      loadAdvancedStatsData();
    });
    $("statsPlayerA").addEventListener("change", e => {
      statsPlayerAId = e.target.value;
      if (statsPlayerAId === statsPlayerBId) {
        statsPlayerBId = statsRoster().find(p => p.id !== statsPlayerAId)?.id || null;
      }
      renderStatsHub();
    });
    $("statsPlayerB").addEventListener("change", e => {
      statsPlayerBId = e.target.value;
      if (statsPlayerAId === statsPlayerBId) {
        statsPlayerAId = statsRoster().find(p => p.id !== statsPlayerBId)?.id || null;
      }
      renderStatsHub();
    });
    $("swapStatsPlayers").addEventListener("click", () => {
      [statsPlayerAId, statsPlayerBId] = [statsPlayerBId, statsPlayerAId];
      renderStatsHub();
    });
    $("duoMinGames").addEventListener("change", renderStatsHub);
    $("statsContent").addEventListener("click", e => {
      const profile = e.target.closest("[data-player-profile]");
      if (profile) return openPlayerProfile(profile.dataset.playerProfile);
      const compare = e.target.closest("[data-compare-a][data-compare-b]");
      if (compare) {
        statsPlayerAId = compare.dataset.compareA;
        statsPlayerBId = compare.dataset.compareB;
        renderStatsHub();
        window.scrollTo({top:$("stats").offsetTop,behavior:"smooth"});
      }
    });


    $("tournamentSize").addEventListener("change", () => {
      const size = Number($("tournamentSize").value);
      const rankedIds = activeSeasonRows().map(p => p.id);
      tournamentEntrantSelection = new Set(rankedIds.filter(id => tournamentEntrantSelection.has(id)).slice(0,size));
      renderTournamentBuilder();
    });
    $("tournamentPlayerSearch").addEventListener("input", renderTournamentBuilder);
    $("autoFillTournamentBtn").addEventListener("click", autoFillTournament);
    $("clearTournamentBtn").addEventListener("click", clearTournamentSelection);
    $("createTournamentBtn").addEventListener("click", createTournament);
    $("tournamentPlayerPicker").addEventListener("change", e => {
      const box = e.target.closest("[data-tournament-player]");
      if (box) toggleTournamentEntrant(box.dataset.tournamentPlayer, box.checked);
    });
    $("tournamentList").addEventListener("click", e => {
      const pick = e.target.closest("[data-tournament-select]");
      if (pick) {
        selectedTournamentId = pick.dataset.tournamentSelect;
        renderTournamentHub();
      }
    });
    $("championHistory").addEventListener("click", e => {
      const pick = e.target.closest("[data-tournament-select]");
      if (pick) {
        selectedTournamentId = pick.dataset.tournamentSelect;
        renderTournamentHub();
        $("tournamentDetail").scrollIntoView({ behavior:"smooth", block:"start" });
      }
    });
    $("tournamentDetail").addEventListener("click", e => {
      const result = e.target.closest("[data-tournament-result]");
      if (result) return openTournamentResult(result.dataset.tournamentResult);
      const profile = e.target.closest("[data-player-profile]");
      if (profile) return openPlayerProfile(profile.dataset.playerProfile);
    });
    $("closeTournamentResult").addEventListener("click", closeTournamentResult);
    $("tournamentResultModal").addEventListener("click", e => {
      if (e.target === $("tournamentResultModal")) closeTournamentResult();
    });
    $("saveTournamentResultBtn").addEventListener("click", saveTournamentResult);

    $$(".chat-channel").forEach(btn => btn.addEventListener("click", async () => {
      activeChatChannel = btn.dataset.chatChannel;
      communityMessages = [];
      communityLoaded = false;
      renderCommunity();
      await loadCommunityData(true);
    }));
    $("chatInput").addEventListener("input", () => {
      $("chatCharCount").textContent = `${$("chatInput").value.length} / 500`;
    });
    $("chatInput").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
    $("sendChatBtn").addEventListener("click", sendChatMessage);
    $("announcementBody").addEventListener("input", () => {
      $("announcementCount").textContent = `${$("announcementBody").value.length} / 1000`;
    });
    $("postAnnouncementBtn").addEventListener("click", postAnnouncement);

    $("announcementList").addEventListener("click", e => {
      const del = e.target.closest("[data-delete-announcement]");
      if (del) deleteAnnouncement(del.dataset.deleteAnnouncement);
    });
    $("chatMessageList").addEventListener("click", e => {
      const del = e.target.closest("[data-delete-chat]");
      if (del) return deleteChatMessage(del.dataset.deleteChat);
      const mute = e.target.closest("[data-mute-chat-user]");
      if (mute) return muteChatUser(mute.dataset.muteChatUser, mute.dataset.muteName || "player");
    });
    $("muteList").addEventListener("click", e => {
      const unmute = e.target.closest("[data-unmute-user]");
      if (unmute) unmuteChatUser(unmute.dataset.unmuteUser);
    });

    ["a1","a2","b1","b2"].forEach(id => $(id).addEventListener("change", updateTeamLabels));
    $("submitMatchBtn").addEventListener("click", submitMatch);

    $("leaderBody").addEventListener("click", e => {
      const btn = e.target.closest("[data-player-profile]");
      if (btn) openPlayerProfile(btn.dataset.playerProfile);
    });
    $("closePlayerProfile").addEventListener("click", closePlayerProfile);
    $("playerProfileModal").addEventListener("click", e => { if (e.target === $("playerProfileModal")) closePlayerProfile(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("playerProfileModal").classList.contains("hidden")) closePlayerProfile(); });

    $("loginBtn").addEventListener("click", () => openAuth("signin"));
    $("loginFromSubmit").addEventListener("click", () => openAuth("signin"));
    $("logoutBtn").addEventListener("click", async () => { if (configured) await sb.auth.signOut(); });
    $("closeAuth").addEventListener("click", closeAuth);
    $("authModal").addEventListener("click", e => { if (e.target === $("authModal")) closeAuth(); });
    $("authSwitch").addEventListener("click", () => { authMode = authMode === "signin" ? "signup" : "signin"; updateAuthModal(); });
    $("authSubmit").addEventListener("click", submitAuth);

    $("claimPlayerBtn").addEventListener("click", requestIdentity);
    $("confirmationList").addEventListener("click", e => {
      const c = e.target.closest("[data-confirm]");
      const d = e.target.closest("[data-dispute]");
      if (c) confirmMatch(c.dataset.confirm);
      if (d) disputeMatch(d.dataset.dispute);
    });

    $("claimQueueList").addEventListener("click", e => {
      const btn = e.target.closest("[data-claim-review]");
      if (btn) reviewIdentityClaim(btn.dataset.claimReview, btn.dataset.decision);
    });

    $("pendingList").addEventListener("click", e => {
      const btn = e.target.closest("[data-review]");
      if (btn) reviewMatch(btn.dataset.review, btn.dataset.decision);
    });

    $("addPlayerBtn").addEventListener("click", addPlayer);
    $("setRatingBtn").addEventListener("click", setRating);
    $("unlinkPlayerBtn").addEventListener("click", unlinkIdentity);
    $("createSeasonBtn").addEventListener("click", createSeason);
  }

  async function boot() {
    wireEvents();
    try {
      await initAuth();
      await loadData();
      subscribeRealtime();
    } catch (err) {
      console.error(err);
      $("syncStatus").textContent = "Connection error";
      const banner = $("modeBanner");
      banner.classList.remove("hidden");
      banner.textContent = `Supabase connection error: ${err.message || err}`;
    }
  }

  boot();
})();
