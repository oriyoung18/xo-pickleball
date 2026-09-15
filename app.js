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
      const status = p.provisional
        ? `<span class="player-sub">Provisional • ${gp}/5 matches${claimed ? " • verified account" : ""}</span>`
        : `<span class="player-sub official-sub">Official${claimed ? " • verified account" : ""}</span>`;
      return `<tr class="${!p.provisional && rank <= 10 ? "top10" : ""} ${!p.provisional && rank <= 3 ? "top3" : ""} ${p.provisional ? "provisional-row" : ""}">
        <td class="rank">${rankCell}</td>
        <td class="player-name">${esc(p.name)}${status}</td>
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
    realtimeChannel = sb.channel("xo-league-live-v3")
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
    });
    ["a1","a2","b1","b2"].forEach(id => $(id).addEventListener("change", updateTeamLabels));
    $("submitMatchBtn").addEventListener("click", submitMatch);

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
