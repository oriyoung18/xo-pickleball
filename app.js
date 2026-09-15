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
  let statsPlayerAId = null;
  let statsPlayerBId = null;
  let statsLoading = false;
  let openProfilePlayerId = null;

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
      season_created:`started ${d.season_name || "a new season"} (${d.starting_mode === "fresh" ? "fresh ratings" : "carried ratings"})`
    };
    return map[a.action] || a.action.replaceAll("_"," ");
  }

  function renderAudit() {
    $("auditList").innerHTML = auditLogs.length ? auditLogs.map(a => `
      <div class="audit-row">
        <div class="audit-icon">${a.action.startsWith("match_") ? "PB" : a.action.startsWith("identity_") ? "ID" : "XO"}</div>
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
    realtimeChannel = sb.channel("xo-league-live-v5")
      .on("postgres_changes", { event:"*", schema:"public", table:"players" }, () => loadData())
      .on("postgres_changes", { event:"*", schema:"public", table:"matches" }, () => loadData())
      .on("postgres_changes", { event:"*", schema:"public", table:"identity_claims" }, async () => { await refreshProfile(); await loadData(); })
      .on("postgres_changes", { event:"*", schema:"public", table:"audit_log" }, () => { if (isCommissioner()) loadData(); })
      .on("postgres_changes", { event:"*", schema:"public", table:"seasons" }, () => loadData())
      .on("postgres_changes", { event:"*", schema:"public", table:"season_player_stats" }, () => loadData())
      .subscribe();
  }

  function wireEvents() {
    $$(".nav-btn").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
    $$('[data-go]').forEach(b => b.addEventListener("click", () => setView(b.dataset.go)));
    $("playerSearch").addEventListener("input", renderLeaderboard);
    $("seasonSelect").addEventListener("change", e => {
      selectedSeasonId = e.target.value;
      renderAll();
      if ($("stats").classList.contains("active")) loadStatsMatches();
    });

    $("statsSeasonSelect").addEventListener("change", e => {
      selectedSeasonId = e.target.value;
      renderAll();
      loadStatsMatches();
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
