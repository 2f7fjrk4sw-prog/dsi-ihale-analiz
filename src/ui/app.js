/**
 * DSİ YAPIM İHALELERİ TEKLİF ANALİZ VE SINIR DEĞER HESAPLAMA SİSTEMİ
 * Resmi Kurumsal Arayüz ve Hesaplama Kontrolcüsü (app.js)
 */

const App = {
  db: null,
  selectedCompetitorId: null,
  competitorRegionFilter: 'ALL',
  competitorBranchFilter: 'ALL',
  selectedRegionalAnalysisId: 'DSI-20',
  selectedRegionalBranchFilter: 'ALL',
  forcedParticipation: {},
  lastSimResult: null,
  lastObservedSyncTimestamp: '',
  syncPollTimer: null,

  async init() {
    await this.loadDatabase();
    this.populateStaticDropdowns();
    this.initManualFormDefaults();
    this.refreshAllViews();
    this.runStandaloneKikCalc();
    this.initOfficialSyncPolling();

    window.addEventListener('resize', () => {
      if (this.lastSimResult) {
        this.drawStrategyChart(this.lastSimResult);
      }
    });
  },

  // =========================================================================
  // 1. VERİTABANI YÜKLEME, KAYDETME VE SHA-256 BÜTÜNLÜK ÖZETİ
  // =========================================================================
  async loadDatabase() {
    // Eski v1 ve v2.0 önbelleğini temizle
    try {
      localStorage.removeItem('dsi_ihale_verified_db_v1');
      localStorage.removeItem('dsi_ihale_official_kik_db_v2');
    } catch (_) {}

    try {
      const resp = await fetch('/api/db', { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.competitors) && Array.isArray(data.tenders)) {
          if (data.metadata && data.metadata.officialSourcesOnly === true &&
              data.metadata.version === '2.4.0') {
            this.db = data;
            localStorage.setItem('dsi_ihale_official_kik_db_v2_1', JSON.stringify(this.db));
            await this.updateDatabaseHash();
            return;
          } else {
            // Eski sürüm veritabanını v2.4.0 DSİ Bölge, Şube ve DSİ Web Keşif veritabanına yükselt
            this.db = createInitialVerifiedDatabase();
            await this.saveDatabase();
            return;
          }
        }
      }
    } catch (_) {}

    const saved = localStorage.getItem('dsi_ihale_official_kik_db_v2_1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.metadata && parsed.metadata.officialSourcesOnly === true &&
            parsed.metadata.version === '2.4.0') {
          this.db = parsed;
        } else {
          this.db = createInitialVerifiedDatabase();
        }
      } catch (_) {
        this.db = createInitialVerifiedDatabase();
      }
    } else {
      this.db = createInitialVerifiedDatabase();
    }
    await this.saveDatabase();
  },

  async reloadDatabaseFromServer() {
    try {
      const resp = await fetch('/api/db', { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.competitors) && Array.isArray(data.tenders)) {
          this.db = data;
          localStorage.setItem('dsi_ihale_official_kik_db_v2_1', JSON.stringify(this.db));
          await this.updateDatabaseHash();
          this.refreshAllViews();
        }
      }
    } catch (_) {}
  },

  async saveDatabase() {
    this.db.metadata = this.db.metadata || {};
    this.db.metadata.version = '2.4.0';
    this.db.metadata.officialSourcesOnly = true;
    this.db.metadata.lastUpdated = new Date().toISOString();

    localStorage.setItem('dsi_ihale_official_kik_db_v2_1', JSON.stringify(this.db));

    try {
      await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.db, null, 2)
      });
    } catch (_) {}

    await this.updateDatabaseHash();
  },

  async updateDatabaseHash() {
    const el = document.getElementById('dbHashDisplay');
    if (!el || !this.db) return;

    const payload = JSON.stringify({
      competitors: this.db.competitors,
      tenders: this.db.tenders
    });

    try {
      if (window.crypto && window.crypto.subtle) {
        const msgBuffer = new TextEncoder().encode(payload);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        this.db.metadata.integrityHash = hashHex;
        el.textContent = hashHex.slice(0, 24) + '...' + hashHex.slice(-8);
        return;
      }
    } catch (_) {}

    let h = 2166136261;
    for (let i = 0; i < payload.length; i++) {
      h ^= payload.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    el.textContent = 'SHA256-YEREL-' + (h >>> 0).toString(16).toUpperCase();
  },

  getActiveVerifiedTenders() {
    if (!this.db || !Array.isArray(this.db.tenders)) return [];
    const includeSample = this.db.metadata?.includeSampleData !== false;

    return this.db.tenders.filter(t => {
      const isVerified = t.verificationStatus === 'VERIFIED_EKAP' || t.verificationStatus === 'VERIFIED_MANUAL';
      if (!isVerified) return false;
      if (!includeSample && t.isSampleCalibration) return false;
      return true;
    });
  },

  toggleSampleData(checked) {
    if (!this.db) return;
    this.db.metadata.includeSampleData = Boolean(checked);
    this.saveDatabase();
    this.refreshAllViews();
  },

  // =========================================================================
  // 2. SEKME VE GÖRÜNÜM YÖNETİMİ
  // =========================================================================
  switchTab(tabId, btnEl) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    if (tabId === 'tab-simulator') {
      this.runMonteCarloSimulation();
    }
  },

  switchDataSubtab(subId) {
    const ids = ['sub-manual', 'sub-smart', 'sub-csv'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = (id === subId) ? 'block' : 'none';
    });

    const btnMap = {
      'sub-manual': 'btnSubManual',
      'sub-smart': 'btnSubSmart',
      'sub-csv': 'btnSubCsv'
    };
    Object.entries(btnMap).forEach(([id, btnId]) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.className = (id === subId) ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
      }
    });
  },

  populateStaticDropdowns() {
    const regionSelects = ['simRegion', 'tFormRegion', 'regionalTabSelect'];
    regionSelects.forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      sel.innerHTML = DSI_REGIONS.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
      sel.value = (selId === 'regionalTabSelect') ? 'DSI-20' : 'DSI-11';
    });

    const compFilterSel = document.getElementById('competitorRegionFilterSelect');
    if (compFilterSel) {
      compFilterSel.innerHTML = `<option value="ALL">Tüm DSİ Bölgeleri (Tümü)</option>` +
        DSI_REGIONS.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
      compFilterSel.value = 'ALL';
    }

    this.populateSimBranches();
    this.populateCompetitorBranchFilter();
    this.populateDsiDiscoveredFilters();

    const groupSelects = ['simWorkGroup', 'tFormWorkGroup'];
    groupSelects.forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      sel.innerHTML = DSI_WORK_GROUPS.map(g => `<option value="${g.code}">${g.name}</option>`).join('');
      sel.value = 'A/III';
    });

    if (typeof OFFICIAL_SOURCE_TYPES !== 'undefined') {
      const sourceSelects = ['newCompSourceType', 'tFormSourceType'];
      sourceSelects.forEach(selId => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        sel.innerHTML = OFFICIAL_SOURCE_TYPES.map(s => `<option value="${s.code}">${s.label}</option>`).join('');
      });
    }
  },

  refreshAllViews() {
    const chk = document.getElementById('toggleSampleData');
    if (chk && this.db) {
      chk.checked = this.db.metadata?.includeSampleData !== false;
    }

    this.renderDashboard();
    this.renderSimulatorCompetitorToggles();
    this.runMonteCarloSimulation();
    this.renderCompetitorsTab();
    this.renderDsiCompetitorsTab();
    this.renderRegionalAnalysisTab();
    this.renderDatacenterTable();
    this.previewManualTenderMath();
  },

  formatTL(num) {
    if (num === null || num === undefined || isNaN(num)) return '0 TL';
    return Math.round(Number(num)).toLocaleString('tr-TR') + ' TL';
  },

  formatMillionsTL(num) {
    if (!num || isNaN(num)) return '0 Milyon TL';
    return (Number(num) / 1_000_000).toFixed(2).replace('.', ',') + ' Milyon TL';
  },

  formatDiscountText(discPct) {
    const val = Number(discPct || 0);
    if (val >= 0) return `%${val.toFixed(2)} İndirim`;
    return `YM +%${Math.abs(val).toFixed(2)} Üzeri`;
  },

  populateSimBranches() {
    const branchSel = document.getElementById('simBranch');
    if (!branchSel) return;
    const regionId = document.getElementById('simRegion')?.value || 'DSI-11';
    const branches = (typeof DSI_BRANCHES !== 'undefined' ? DSI_BRANCHES : [])
      .filter(b => b.regionId === regionId);
    branchSel.innerHTML = `<option value="ALL">Tüm Şubeler (Bölge Genelinde)</option>` +
      branches.map(b => `<option value="${b.id}">${b.code}. Şube — ${b.city} (${b.name.split('Şube')[0].trim()})</option>`).join('');
    branchSel.value = 'ALL';
  },

  onSimRegionChanged() {
    this.populateSimBranches();
    this.onSimParamsChanged();
    this.runMonteCarloSimulation();
  },

  populateCompetitorBranchFilter() {
    const sel = document.getElementById('competitorBranchFilterSelect');
    if (!sel || typeof DSI_BRANCHES === 'undefined') return;
    const regFilter = this.competitorRegionFilter || 'ALL';
    const list = regFilter === 'ALL'
      ? DSI_BRANCHES
      : DSI_BRANCHES.filter(b => b.regionId === regFilter);
    sel.innerHTML = `<option value="ALL">Tüm DSİ Şubeleri (Tümü)</option>` +
      list.map(b => `<option value="${b.id}">${b.code}. Şube (${b.city})</option>`).join('');
    if (this.competitorBranchFilter && list.some(b => b.id === this.competitorBranchFilter)) {
      sel.value = this.competitorBranchFilter;
    } else {
      sel.value = 'ALL';
      this.competitorBranchFilter = 'ALL';
    }
  },

  getRegionName(regionId) {
    const r = DSI_REGIONS.find(x => x.id === regionId);
    return r ? r.name : regionId;
  },

  getBranchName(subeId) {
    if (!subeId || subeId === 'ALL' || typeof DSI_BRANCHES === 'undefined') return '';
    const b = DSI_BRANCHES.find(x => x.id === subeId);
    return b ? b.name : subeId;
  },

  getCompetitorName(compId) {
    if (!this.db) return compId;
    const c = this.db.competitors.find(x => x.id === compId);
    return c ? (c.shortName || c.name) : compId;
  },

  // =========================================================================
  // 3. BÖLÜM 1: GENEL ÖZET VE İHALE ARŞİVİ
  // =========================================================================
  renderDashboard() {
    const tenders = this.getActiveVerifiedTenders();
    const competitors = this.db?.competitors || [];

    document.getElementById('kpiVerifiedTenders').textContent = tenders.length;
    document.getElementById('kpiCompetitorCount').textContent = competitors.length;

    const totalSignals = competitors.reduce(
      (acc, c) => acc + (c.signals ? c.signals.filter(s => s.verified !== false).length : 0),
      0
    );
    document.getElementById('kpiActiveSignalsSub').textContent = `${totalSignals} Kayıtlı Şantiye / Sicil Durum Bilgisi`;

    const infraTenders = tenders.filter(t => Number(t.nCoeff || 1.20) >= 1.15);
    const poolForSd = infraTenders.length > 0 ? infraTenders : tenders;

    let avgSdDiscount = 0;
    let avgWinnerDiscount = 0;
    let avgMarginAboveSD = 0;

    if (poolForSd.length > 0) {
      const sdDiscounts = poolForSd.map(t => ((t.approxCost - t.reportedBoundaryValue) / t.approxCost) * 100);
      avgSdDiscount = sdDiscounts.reduce((a, b) => a + b, 0) / sdDiscounts.length;

      let winCount = 0;
      let winDiscountSum = 0;
      let marginSum = 0;

      for (const t of poolForSd) {
        const winBidObj = (t.bids || []).find(b => b.competitorId === t.winnerCompetitorId);
        if (winBidObj) {
          winCount++;
          const wDisc = ((t.approxCost - winBidObj.amount) / t.approxCost) * 100;
          const mAbove = ((winBidObj.amount - t.reportedBoundaryValue) / t.reportedBoundaryValue) * 100;
          winDiscountSum += wDisc;
          marginSum += mAbove;
        }
      }

      if (winCount > 0) {
        avgWinnerDiscount = winDiscountSum / winCount;
        avgMarginAboveSD = marginSum / winCount;
      }
    }

    document.getElementById('kpiAvgBoundaryDiscount').textContent = `%${avgSdDiscount.toFixed(2)}`;
    document.getElementById('kpiAvgWinnerDiscount').textContent = `%${avgWinnerDiscount.toFixed(2)}`;
    document.getElementById('kpiAvgMarginAboveSD').textContent = `Sınır Değerin Ortalama +%${avgMarginAboveSD.toFixed(2)} Üzeri`;

    const tbodyTenders = document.getElementById('dashboardTendersBody');
    if (tenders.length === 0) {
      tbodyTenders.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">
        Görüntülenecek doğrulanmış ihale kaydı bulunmamaktadır. Üst menüden örnek verileri açabilir veya 4. Bölümden yeni ihale tutanağı ekleyebilirsiniz.
      </td></tr>`;
    } else {
      const sorted = [...tenders].sort((a, b) => new Date(b.date) - new Date(a.date));
      tbodyTenders.innerHTML = sorted.map(t => {
        const sdDisc = ((t.approxCost - t.reportedBoundaryValue) / t.approxCost) * 100;
        const winBid = (t.bids || []).find(b => b.competitorId === t.winnerCompetitorId);
        const winDisc = winBid ? (((t.approxCost - winBid.amount) / t.approxCost) * 100).toFixed(2) : '-';
        const winName = winBid ? this.getCompetitorName(t.winnerCompetitorId) : 'Belirlenmedi';

        return `
          <tr>
            <td>
              <div style="font-weight:700; color:#1d4ed8;">İKN: ${t.ikn}</div>
              <div style="font-size:11.5px; color:var(--text-muted);">${t.date}</div>
              ${t.kikDecisionNo ? `<div style="font-size:11px; color:#15803d; font-weight:700;">KİK: ${t.kikDecisionNo}</div>` : ''}
            </td>
            <td>
              <div style="font-weight:600; color:var(--text-primary);">${t.title}</div>
              <div style="font-size:11.5px; color:var(--text-muted);">${this.getRegionName(t.regionId)}${t.subeName ? ` • <strong style="color:#1e40af;">${t.subeName}</strong>` : ''} • İş Grubu: ${t.workGroup}</div>
              <div style="font-size:11px; color:#1e40af; margin-top:2px;">Resmi Kaynak: ${t.verificationSource || 'EKAP / KİK Resmi Kaydı'}</div>
            </td>
            <td style="font-weight:600;">${this.formatTL(t.approxCost)}</td>
            <td>
              <div style="font-weight:700; color:#b45309;">${this.formatTL(t.reportedBoundaryValue)}</div>
              <div style="font-size:11.5px; color:var(--text-muted);">%${sdDisc.toFixed(2)} İndirim (N=${Number(t.nCoeff || 1.2).toFixed(2)})</div>
            </td>
            <td>
              <span class="badge badge-verified">${winName}</span>
              <div style="font-size:11.5px; color:#15803d; margin-top:3px; font-weight:700;">%${winDisc} İndirim (${winBid ? this.formatMillionsTL(winBid.amount) : '-'})</div>
            </td>
          </tr>
        `;
      }).join('');
    }

    const tbodyComp = document.getElementById('dashboardCompetitorsBody');
    const profiles = competitors.map(c => CompetitorPredictionEngine.analyzeCompetitor(c, tenders, {
      regionId: 'DSI-05',
      workGroup: 'A/III',
      approxCost: 250000000,
      nCoeff: 1.20
    }));

    tbodyComp.innerHTML = profiles.map(p => {
      let badgeClass = 'badge-blue';
      if (p.archetypeCode === 'BOUNDARY_HUNTER') badgeClass = 'badge-verified';
      else if (p.archetypeCode === 'AGGRESSIVE') badgeClass = 'badge-rose';
      else if (p.archetypeCode === 'CONSERVATIVE') badgeClass = 'badge-amber';

      const satColor = p.capacitySaturationPct > 75 ? '#b91c1c' : (p.capacitySaturationPct < 40 ? '#15803d' : '#1d4ed8');

      return `
        <tr style="cursor:pointer;" onclick="App.openCompetitorDetailFromDashboard('${p.competitorId}')" title="Firma detaylarını görmek için tıklayınız">
          <td>
            <div style="font-weight:700; color:var(--corp-navy);">${p.shortName}</div>
            <div style="font-size:11.5px; color:var(--text-muted);">${p.hqCity} • ${p.verifiedTenderCount} İhale (${p.winCount} Kazanılan)</div>
          </td>
          <td><span class="badge ${badgeClass}">${p.archetype}</span></td>
          <td style="min-width:115px;">
            <div style="display:flex; justify-content:space-between; font-size:11.5px;">
              <span>Şantiye Yükü</span>
              <strong>%${p.capacitySaturationPct}</strong>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${p.capacitySaturationPct}%; background:${satColor};"></div>
            </div>
          </td>
          <td>
            <div style="font-weight:800; color:#1d4ed8; font-size:14px;">%${p.expectedDiscountPct.toFixed(2)}</div>
            <div style="font-size:11.5px; color:var(--text-muted);">±%${p.expectedDiscountStd.toFixed(2)} Değişim</div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openCompetitorDetailFromDashboard(compId) {
    this.selectedCompetitorId = compId;
    const btn = document.querySelector('[data-tab="tab-competitors"]');
    this.switchTab('tab-competitors', btn);
    this.renderCompetitorsTab();
  },

  // =========================================================================
  // 4. BÖLÜM 2: YENİ İHALE TEKLİF VE SINIR DEĞER HESAPLAMA
  // =========================================================================
  onSimWorkGroupChanged() {
    const wgCode = document.getElementById('simWorkGroup').value;
    const wg = DSI_WORK_GROUPS.find(g => g.code === wgCode);
    if (wg) {
      document.getElementById('simNCoeff').value = wg.defaultN.toFixed(2);
    }
    this.onSimParamsChanged();
  },

  onSimParamsChanged() {
    const evalMode = document.getElementById('simEvalMode').value;
    const fduBox = document.getElementById('simFduBox');
    if (fduBox) {
      fduBox.style.display = (evalMode === 'FDU_SCORE') ? 'block' : 'none';
    }

    const baseYM = Number(document.getElementById('simApproxCost').value || 250000000);
    const spread = Number(document.getElementById('simYmSpread').value || 2.5);
    const lowM = ((baseYM * (1 - spread / 100)) / 1_000_000).toFixed(1);
    const highM = ((baseYM * (1 + spread / 100)) / 1_000_000).toFixed(1);
    const rangePreview = document.getElementById('simYmRangePreview');
    if (rangePreview) {
      rangePreview.textContent = `${lowM} Milyon TL — ${highM} Milyon TL`;
    }

    this.renderSimulatorCompetitorToggles();
  },

  getTargetTenderConfigFromUI() {
    return {
      title: document.getElementById('simTitle')?.value || 'Hedef DSİ İhalesi',
      regionId: document.getElementById('simRegion')?.value || 'DSI-05',
      subeId: document.getElementById('simBranch')?.value || 'ALL',
      workGroup: document.getElementById('simWorkGroup')?.value || 'A/III',
      approxCost: Number(document.getElementById('simApproxCost')?.value || 250000000),
      nCoeff: Number(document.getElementById('simNCoeff')?.value || 1.20),
      ymUncertaintyPct: Number(document.getElementById('simYmSpread')?.value ?? 2.5),
      evalMode: document.getElementById('simEvalMode')?.value || 'AUTO_REJECT',
      ourFduScore: Number(document.getElementById('simOurFduScore')?.value || 88)
    };
  },

  renderSimulatorCompetitorToggles() {
    const container = document.getElementById('simCompetitorToggles');
    if (!container || !this.db) return;

    const target = this.getTargetTenderConfigFromUI();
    const tenders = this.getActiveVerifiedTenders();

    const profiles = this.db.competitors
      .map(c => CompetitorPredictionEngine.analyzeCompetitor(c, tenders, target))
      .sort((a, b) => {
        if (Boolean(b.hasTargetBranchExperience) !== Boolean(a.hasTargetBranchExperience)) {
          return b.hasTargetBranchExperience ? 1 : -1;
        }
        if (Boolean(b.hasTargetRegionExperience) !== Boolean(a.hasTargetRegionExperience)) {
          return b.hasTargetRegionExperience ? 1 : -1;
        }
        return (b.participationPct || 0) - (a.participationPct || 0);
      });

    container.innerHTML = profiles.map(p => {
      const currentMode = this.forcedParticipation[p.competitorId] || 'AUTO';
      const branchTag = p.hasTargetBranchExperience
        ? `<span class="badge badge-verified" style="font-size:10px; padding:1px 5px; margin-left:4px;">Şube Deneyimli</span>`
        : '';
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:#f8fafc; border:1px solid var(--border-color); border-radius:6px; margin-bottom:6px;">
          <div>
            <div style="font-size:12.5px; font-weight:700; color:var(--corp-navy);">${p.shortName}${branchTag}</div>
            <div style="font-size:11.5px; color:var(--text-secondary);">
              Katılım İhtimali: <strong style="color:#1d4ed8;">%${p.participationPct.toFixed(0)}</strong> •
              Tahmini İndirim: <strong>%${p.expectedDiscountPct.toFixed(1)}</strong>
            </div>
          </div>
          <select style="width:145px; padding:5px 8px; font-size:12px;"
            onchange="App.setForcedParticipation('${p.competitorId}', this.value)">
            <option value="AUTO" ${currentMode === 'AUTO' ? 'selected' : ''}>Olasılığa Göre (%${p.participationPct.toFixed(0)})</option>
            <option value="FORCE_IN" ${currentMode === 'FORCE_IN' ? 'selected' : ''}>Kesin Katılır (%100)</option>
            <option value="FORCE_OUT" ${currentMode === 'FORCE_OUT' ? 'selected' : ''}>Katılmaz (%0)</option>
          </select>
        </div>
      `;
    }).join('');
  },

  setForcedParticipation(compId, mode) {
    this.forcedParticipation[compId] = mode;
    this.runMonteCarloSimulation();
  },

  runMonteCarloSimulation() {
    if (!this.db) return;
    this.onSimParamsChanged();

    const target = this.getTargetTenderConfigFromUI();
    const tenders = this.getActiveVerifiedTenders();

    const profiles = this.db.competitors
      .map(c => CompetitorPredictionEngine.analyzeCompetitor(c, tenders, target))
      .sort((a, b) => {
        if (Boolean(b.hasTargetBranchExperience) !== Boolean(a.hasTargetBranchExperience)) {
          return b.hasTargetBranchExperience ? 1 : -1;
        }
        if (Boolean(b.hasTargetRegionExperience) !== Boolean(a.hasTargetRegionExperience)) {
          return b.hasTargetRegionExperience ? 1 : -1;
        }
        return (b.participationPct || 0) - (a.participationPct || 0);
      });

    const simResult = MonteCarloTenderSimulator.runSimulation({
      estimatedYM: target.approxCost,
      ymUncertaintyPct: target.ymUncertaintyPct,
      nCoeff: target.nCoeff,
      evalMode: target.evalMode,
      ourFduScore: target.ourFduScore,
      iterations: 10000,
      competitorProfiles: profiles,
      forcedParticipation: this.forcedParticipation
    });

    this.lastSimResult = simResult;

    const { safe, optimal, aggressive } = simResult.recommendations;

    document.getElementById('resSafePrice').textContent = this.formatTL(safe.bidAmount);
    document.getElementById('resSafeKirim').textContent = `%${safe.discountPct.toFixed(2)} İndirim (Tenkisat)`;
    document.getElementById('resSafeWin').textContent = `%${safe.winProbPct.toFixed(1)}`;
    document.getElementById('resSafeRisk').textContent = `%${safe.belowSdRiskPct.toFixed(1)}`;

    document.getElementById('resOptPrice').textContent = this.formatTL(optimal.bidAmount);
    document.getElementById('resOptKirim').textContent = `%${optimal.discountPct.toFixed(2)} İndirim (Tenkisat)`;
    document.getElementById('resOptWin').textContent = `%${optimal.winProbPct.toFixed(1)}`;
    document.getElementById('resOptRisk').textContent = `%${optimal.belowSdRiskPct.toFixed(1)}`;

    document.getElementById('resAggPrice').textContent = this.formatTL(aggressive.bidAmount);
    document.getElementById('resAggKirim').textContent = `%${aggressive.discountPct.toFixed(2)} İndirim (Tenkisat)`;
    document.getElementById('resAggWin').textContent = `%${aggressive.winProbPct.toFixed(1)}`;
    document.getElementById('resAggRisk').textContent = `%${aggressive.belowSdRiskPct.toFixed(1)}`;

    const bStats = simResult.boundaryStats;
    document.getElementById('resSdBadge').textContent = `Beklenen Ortalama Sınır Değer İndirimi: %${bStats.meanDiscountPct.toFixed(2)} (N=${target.nCoeff.toFixed(2)})`;

    document.getElementById('resSdP15').textContent = this.formatTL(bStats.p15);
    document.getElementById('resSdP15Kirim').textContent = `%${bStats.p85DiscountPct.toFixed(2)} İndirim`;

    document.getElementById('resSdMean').textContent = this.formatTL(bStats.mean);
    document.getElementById('resSdMeanKirim').textContent = `%${bStats.meanDiscountPct.toFixed(2)} İndirim`;

    document.getElementById('resSdP85').textContent = this.formatTL(bStats.p85);
    document.getElementById('resSdP85Kirim').textContent = `%${bStats.p15DiscountPct.toFixed(2)} İndirim`;

    this.drawStrategyChart(simResult);

    const tbody = document.getElementById('simCompetitorResultsBody');
    tbody.innerHTML = simResult.competitorSimResults.map(r => {
      let badgeClass = 'badge-blue';
      if (r.archetypeCode === 'BOUNDARY_HUNTER') badgeClass = 'badge-verified';
      else if (r.archetypeCode === 'AGGRESSIVE') badgeClass = 'badge-rose';
      else if (r.archetypeCode === 'CONSERVATIVE') badgeClass = 'badge-amber';

      return `
        <tr>
          <td>
            <div style="font-weight:700; color:var(--corp-navy);">${r.shortName}${r.hasTargetBranchExperience ? ` <span class="badge badge-verified" style="font-size:10px; padding:1px 5px;">Şube Deneyimli</span>` : ''}</div>
            <div style="font-size:11.5px; color:var(--text-muted);">${r.activeSignals.length} Kayıtlı Durum Bilgisi</div>
          </td>
          <td><span class="badge ${badgeClass}">${r.archetype}</span></td>
          <td>
            <div style="font-weight:700; color:#1d4ed8;">%${r.simulatedParticipationPct.toFixed(1)}</div>
          </td>
          <td>
            <div style="font-weight:700; color:#b45309;">Ortalama %${r.simulatedMeanDiscountPct.toFixed(2)}</div>
            <div style="font-size:11.5px; color:var(--text-muted);">
              (%${r.simulatedDiscountRange[0].toFixed(1)} ile %${r.simulatedDiscountRange[1].toFixed(1)} arası)
            </div>
          </td>
          <td>
            <div style="font-weight:700;">${this.formatTL(r.simulatedMeanBid)}</div>
            <div style="font-size:11.5px; color:var(--text-muted);">
              ${this.formatMillionsTL(r.simulatedBidRange[0])} – ${this.formatMillionsTL(r.simulatedBidRange[1])}
            </div>
          </td>
          <td>
            <span style="font-weight:800; font-size:14px; color:${r.simulatedWinProbPct > 20 ? '#15803d' : '#475569'};">
              %${r.simulatedWinProbPct.toFixed(1)}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  },

  drawStrategyChart(simResult) {
    const canvas = document.getElementById('strategyChartCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const width = Math.max(600, rect.width - 24);
    const height = 240;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const padLeft = 52;
    const padRight = 24;
    const padTop = 24;
    const padBottom = 36;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const curve = simResult.strategyCurve;
    if (!curve || curve.length === 0) return;

    const minD = curve[0].discountPct;
    const maxD = curve[curve.length - 1].discountPct;

    const xOf = d => padLeft + ((d - minD) / (maxD - minD)) * plotW;
    const yOf = pct => padTop + plotH - (Math.min(100, Math.max(0, pct)) / 100) * plotH;

    // Yatay Kılavuz Çizgileri (Açık Kurumsal Tema)
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#475569';
    ctx.font = '600 11px Segoe UI, sans-serif';

    for (let p = 0; p <= 100; p += 25) {
      const y = yOf(p);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(`%${p}`, 10, y + 4);
    }

    // X Ekseni İndirim Oranı Etiketleri
    for (let d = 15; d <= 45; d += 5) {
      if (d < minD || d > maxD) continue;
      const x = xOf(d);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
      ctx.fillText(`%${d} İndirim`, x - 28, height - 10);
    }

    // 1. Sınır Değer Altı Elenme Riski Eğrisi (Koyu Kırmızı)
    ctx.beginPath();
    curve.forEach((pt, idx) => {
      const x = xOf(pt.discountPct);
      const y = yOf(pt.belowSdRiskPct);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#b91c1c';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 2. Kazanma Olasılığı Eğrisi (Kurumsal Yeşil)
    ctx.beginPath();
    curve.forEach((pt, idx) => {
      const x = xOf(pt.discountPct);
      const y = yOf(pt.winProbPct);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.lineTo(xOf(curve[curve.length - 1].discountPct), padTop + plotH);
    ctx.lineTo(xOf(curve[0].discountPct), padTop + plotH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, 'rgba(21, 128, 61, 0.22)');
    grad.addColorStop(1, 'rgba(21, 128, 61, 0.02)');
    ctx.fillStyle = grad;
    ctx.fill();

    // 3. Önerilen İdeal Teklif Noktası İşaretçisi
    const opt = simResult.recommendations.optimal;
    if (opt) {
      const ox = xOf(opt.discountPct);
      const oy = yOf(opt.winProbPct);

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(ox, padTop);
      ctx.lineTo(ox, padTop + plotH);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(ox, oy, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#15803d';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.fillStyle = '#0f2942';
      ctx.font = 'bold 12px Segoe UI, sans-serif';
      const label = `Önerilen İdeal Nokta: %${opt.discountPct.toFixed(2)} İndirim (Kazanma Olasılığı: %${opt.winProbPct.toFixed(1)})`;
      const textX = Math.min(width - 340, Math.max(padLeft + 8, ox - 120));
      ctx.fillText(label, textX, padTop + 15);
    }
  },

  // =========================================================================
  // 5. BÖLÜM 3: RAKİP FİRMA (İSTEKLİ) KAYITLARI VE ANALİZİ
  // =========================================================================
  toggleNewCompetitorBox() {
    const box = document.getElementById('newCompetitorBox');
    if (!box) return;
    box.style.display = (box.style.display === 'none') ? 'block' : 'none';
  },

  saveNewCompetitor() {
    const name = document.getElementById('newCompName').value.trim();
    const shortName = document.getElementById('newCompShort').value.trim() || name;
    const taxId = document.getElementById('newCompTax').value.trim() || 'EKAP-RESMİ';
    const hqCity = document.getElementById('newCompCity').value.trim() || 'Ankara';
    const sat = Number(document.getElementById('newCompSat').value || 50);
    const cap = Number(document.getElementById('newCompCap').value || 800000000);
    const groupsRaw = document.getElementById('newCompGroups').value || 'A/III';
    const sourceTypeCode = document.getElementById('newCompSourceType')?.value || 'KIK_KARAR';
    const sourceRef = document.getElementById('newCompSource').value.trim();

    if (!name) {
      alert('Lütfen firmanın resmi ticaret ünvanını giriniz.');
      return;
    }

    if (!sourceRef) {
      alert('Sadece resmi kaynaklı veri girişine izin verilmektedir. Lütfen firmanın yer aldığı resmi İKN, KİK Kurul Karar Numarası veya Ticaret Sicil Gazetesi sayı/tarih bilgisini giriniz.');
      return;
    }

    const srcObj = (typeof OFFICIAL_SOURCE_TYPES !== 'undefined')
      ? OFFICIAL_SOURCE_TYPES.find(s => s.code === sourceTypeCode)
      : null;
    const fullOfficialSource = `${srcObj ? srcObj.label : 'Resmi Kaynak'} — Ref: ${sourceRef}`;

    const newId = 'COMP-' + String(Date.now()).slice(-5);
    const workGroups = groupsRaw.split(',').map(s => s.trim()).filter(Boolean);

    const newComp = {
      id: newId,
      name,
      shortName,
      taxId,
      hqCity,
      primaryRegions: ['DSI-11'],
      workGroups: workGroups.length ? workGroups : ['A/III'],
      maxTenderCapacityTL: cap,
      activeProjectCount: 2,
      capacitySaturationPct: Math.min(100, Math.max(0, sat)),
      fduCompetencyScore: 85,
      officialSourceType: sourceTypeCode,
      officialSourceUrl: srcObj ? srcObj.url : 'https://ekap.kik.gov.tr',
      verificationSource: fullOfficialSource,
      notes: 'Resmi kamu kaynağı referansı ile eklenen müteahhit firma kaydı.',
      signals: []
    };

    this.db.competitors.push(newComp);
    this.selectedCompetitorId = newId;
    this.saveDatabase();
    this.toggleNewCompetitorBox();
    this.refreshAllViews();
  },

  onCompetitorRegionFilterChanged(regionId) {
    this.competitorRegionFilter = regionId || 'ALL';
    this.competitorBranchFilter = 'ALL';
    this.populateCompetitorBranchFilter();
    this.renderCompetitorsTab();
  },

  onCompetitorBranchFilterChanged(branchId) {
    this.competitorBranchFilter = branchId || 'ALL';
    this.renderCompetitorsTab();
  },

  onCompetitorFilterOrSortChanged() {
    this.renderCompetitorsTab();
  },

  renderCompetitorsTab() {
    if (!this.db || !this.db.competitors.length) return;

    const tenders = this.getActiveVerifiedTenders();
    const listContainer = document.getElementById('competitorListContainer');
    const searchVal = (document.getElementById('competitorSearchInput')?.value || '').trim().toLocaleLowerCase('tr-TR');
    const originFilter = document.getElementById('competitorOriginFilter')?.value || 'ALL';
    const sortMode = document.getElementById('competitorSortSelect')?.value || 'TENDERS_DESC';

    const enriched = this.db.competitors.map(c => {
      const prof = CompetitorPredictionEngine.analyzeCompetitor(c, tenders);
      const isDsiWeb = c.discoveredFromDsi === true || c.officialSourceType === 'DSI_WEB_SEARCH';
      return { comp: c, prof, isDsiWeb };
    });

    let filtered = (this.competitorRegionFilter && this.competitorRegionFilter !== 'ALL')
      ? enriched.filter(x => (x.prof.allActiveRegions || []).includes(this.competitorRegionFilter))
      : enriched;

    if (this.competitorBranchFilter && this.competitorBranchFilter !== 'ALL') {
      filtered = filtered.filter(x => (x.prof.allActiveBranches || []).includes(this.competitorBranchFilter));
    }

    if (originFilter === 'DSI_WEB') {
      filtered = filtered.filter(x => x.isDsiWeb);
    } else if (originFilter === 'KIK_EKAP') {
      filtered = filtered.filter(x => !x.isDsiWeb);
    }

    if (searchVal) {
      filtered = filtered.filter(x => {
        const hay = [
          x.comp.name,
          x.comp.shortName,
          x.comp.hqCity,
          x.comp.taxId,
          x.comp.dsiProjectTitle,
          x.comp.verificationSource
        ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
        return hay.includes(searchVal);
      });
    }

    filtered.sort((a, b) => {
      if (sortMode === 'NAME_ASC') {
        return (a.comp.shortName || a.comp.name).localeCompare(b.comp.shortName || b.comp.name, 'tr-TR');
      }
      if (sortMode === 'DISCOUNT_DESC') {
        return (b.prof.expectedDiscountPct || 0) - (a.prof.expectedDiscountPct || 0);
      }
      if (sortMode === 'CAPACITY_DESC') {
        return (b.comp.maxTenderCapacityTL || 0) - (a.comp.maxTenderCapacityTL || 0);
      }
      // TENDERS_DESC
      if ((b.prof.verifiedTenderCount || 0) !== (a.prof.verifiedTenderCount || 0)) {
        return (b.prof.verifiedTenderCount || 0) - (a.prof.verifiedTenderCount || 0);
      }
      return (b.prof.winCount || 0) - (a.prof.winCount || 0);
    });

    const countBadge = document.getElementById('competitorListCountBadge');
    if (countBadge) {
      countBadge.textContent = `${filtered.length} / ${enriched.length} Firma`;
    }

    if (filtered.length > 0 && !filtered.some(x => x.comp.id === this.selectedCompetitorId)) {
      this.selectedCompetitorId = filtered[0].comp.id;
    } else if (!this.selectedCompetitorId && this.db.competitors.length > 0) {
      this.selectedCompetitorId = this.db.competitors[0].id;
    }

    if (filtered.length === 0) {
      const filterDesc = this.competitorBranchFilter !== 'ALL'
        ? this.getBranchName(this.competitorBranchFilter)
        : this.getRegionName(this.competitorRegionFilter);
      listContainer.innerHTML = `
        <div style="padding:18px; text-align:center; color:var(--text-muted); border:1px dashed var(--border-color); border-radius:6px;">
          Seçilen filtreler (${this.escapeHtml(filterDesc)}) için kayıtlı rakip firma bulunmamaktadır.
          <div style="margin-top:8px;">
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('competitorSearchInput').value=''; document.getElementById('competitorOriginFilter').value='ALL'; document.getElementById('competitorRegionFilterSelect').value='ALL'; App.onCompetitorRegionFilterChanged('ALL');">
              Filtreleri Temizle ve Tüm Firmaları Göster
            </button>
          </div>
        </div>
      `;
    } else {
      listContainer.innerHTML = filtered.map(({ comp: c, prof, isDsiWeb }) => {
        const isSelected = c.id === this.selectedCompetitorId;
        const originBadge = isDsiWeb
          ? `<span class="badge badge-verified" style="font-size:10px; padding:1px 6px; background:#ecfdf5; color:#047857; border-color:#a7f3d0;">DSİ Web Keşfi</span>`
          : `<span class="badge badge-blue" style="font-size:10px; padding:1px 6px;">KİK / EKAP</span>`;

        const regionBadges = (prof.regionalBreakdown || [])
          .slice(0, 4)
          .map(rb => `<span class="badge ${rb.winCount > 0 ? 'badge-verified' : 'badge-blue'}" style="font-size:10px; padding:1px 6px;">${rb.regionId} (${rb.city || rb.regionName.split('(')[0].trim()})</span>`)
          .join(' ');
        const branchBadges = (prof.branchBreakdown || [])
          .slice(0, 2)
          .map(bb => `<span class="badge badge-blue" style="font-size:10px; padding:1px 5px; background:#f0f9ff; color:#0369a1; border-color:#bae6fd;">${bb.subeCode}. Şube</span>`)
          .join(' ');

        return `
          <div onclick="App.selectCompetitor('${c.id}')"
            style="padding:10px 12px; border-radius:6px; cursor:pointer; transition:all 0.15s;
            background:${isSelected ? '#eff6ff' : '#ffffff'};
            border:${isSelected ? '2px solid #1d4ed8' : '1px solid var(--border-color)'};">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
              <div>
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <strong style="font-size:13.5px; color:var(--corp-navy);">${this.escapeHtml(c.shortName || c.name)}</strong>
                  ${originBadge}
                </div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${this.escapeHtml(c.name)}</div>
              </div>
              <span class="badge badge-blue" style="white-space:nowrap;">%${prof.expectedDiscountPct.toFixed(2)} İndirim</span>
            </div>
            <div style="font-size:11.5px; color:var(--text-secondary); margin-top:5px;">
              Merkez: ${this.escapeHtml(c.hqCity || '-')} • Kayıt: ${this.escapeHtml(c.taxId || '-')} • Gruplar: ${(c.workGroups || []).join(', ')}
            </div>
            <div style="margin-top:5px; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
              ${regionBadges || '<span style="font-size:11px; color:var(--text-muted);">Bölge Belirtilmedi</span>'}
              ${branchBadges}
            </div>
            <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--text-muted); margin-top:5px;">
              <span>İhale: <strong style="color:#15803d;">${prof.verifiedTenderCount}</strong> (Kazanılan: ${prof.winCount})</span>
              <span>Kapasite Yükü: <strong>%${c.capacitySaturationPct ?? 50}</strong></span>
            </div>
          </div>
        `;
      }).join('');
    }

    this.renderSelectedCompetitorDetail();
  },

  populateDsiDiscoveredFilters() {
    const regSel = document.getElementById('dsiDiscRegionFilter');
    if (regSel && typeof DSI_REGIONS !== 'undefined') {
      regSel.innerHTML = `<option value="ALL">Tüm DSİ Bölgeleri</option>` +
        DSI_REGIONS.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    }
    const brSel = document.getElementById('dsiDiscBranchFilter');
    if (brSel && typeof DSI_BRANCHES !== 'undefined') {
      brSel.innerHTML = `<option value="ALL">Tüm DSİ Şubeleri</option>` +
        DSI_BRANCHES.map(b => `<option value="${b.id}">${b.code}. Şube (${b.city})</option>`).join('');
    }
  },

  renderDsiCompetitorsTab() {
    const tbody = document.getElementById('dsiDiscoveredCompetitorsBody');
    if (!tbody || !this.db || !Array.isArray(this.db.competitors)) return;

    const tenders = this.getActiveVerifiedTenders();
    const searchVal = (document.getElementById('dsiDiscSearchInput')?.value || '').trim().toLocaleLowerCase('tr-TR');
    const regFilter = document.getElementById('dsiDiscRegionFilter')?.value || 'ALL';
    const brFilter = document.getElementById('dsiDiscBranchFilter')?.value || 'ALL';

    const dsiComps = this.db.competitors
      .filter(c => c.discoveredFromDsi === true || c.officialSourceType === 'DSI_WEB_SEARCH')
      .map(c => ({
        comp: c,
        prof: CompetitorPredictionEngine.analyzeCompetitor(c, tenders)
      }));

    // KPI Özeti (filtreden bağımsız tüm DSİ keşif özeti)
    const activeRegionsSet = new Set();
    const activeBranchesSet = new Set();
    let totalContractVolume = 0;
    let discSum = 0;

    dsiComps.forEach(({ comp, prof }) => {
      (prof.allActiveRegions || []).forEach(r => activeRegionsSet.add(r));
      (prof.allActiveBranches || []).forEach(b => activeBranchesSet.add(b));
      totalContractVolume += prof.totalWonVolume || prof.totalBidVolume || 0;
      discSum += prof.expectedDiscountPct || 0;
    });

    const elCount = document.getElementById('dsiDiscKpiCount');
    const elRegs = document.getElementById('dsiDiscKpiRegions');
    const elVol = document.getElementById('dsiDiscKpiVolume');
    const elAvg = document.getElementById('dsiDiscKpiAvgDisc');

    if (elCount) elCount.textContent = dsiComps.length;
    if (elRegs) elRegs.textContent = `${activeRegionsSet.size} Bölge / ${activeBranchesSet.size} Şube`;
    if (elVol) elVol.textContent = this.formatMillionsTL(totalContractVolume);
    if (elAvg) elAvg.textContent = dsiComps.length > 0 ? `%${(discSum / dsiComps.length).toFixed(2)}` : '%0.00';

    let filtered = dsiComps;
    if (regFilter !== 'ALL') {
      filtered = filtered.filter(x => (x.prof.allActiveRegions || []).includes(regFilter));
    }
    if (brFilter !== 'ALL') {
      filtered = filtered.filter(x => (x.prof.allActiveBranches || []).includes(brFilter));
    }
    if (searchVal) {
      filtered = filtered.filter(({ comp }) => {
        const hay = [
          comp.name,
          comp.shortName,
          comp.hqCity,
          comp.dsiProjectTitle,
          comp.verificationSource
        ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
        return hay.includes(searchVal);
      });
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:18px; color:var(--text-muted);">Seçilen kriterlere uygun DSİ kaynaklı rakip bulunamadı.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(({ comp: c, prof }) => {
      const regionId = (prof.allActiveRegions && prof.allActiveRegions[0]) || (c.primaryRegions && c.primaryRegions[0]) || 'DSI-GM';
      const subeId = (prof.allActiveBranches && prof.allActiveBranches[0]) || (c.primaryBranches && c.primaryBranches[0]) || 'ALL';
      const branchLabel = subeId !== 'ALL' ? this.getBranchName(subeId) : `${regionId} Bölge`;

      const compTenders = tenders.filter(t =>
        t.winnerCompetitorId === c.id || (t.bids || []).some(b => b.competitorId === c.id)
      );
      const primaryTender = compTenders[0];
      const projectTitle = c.dsiProjectTitle || primaryTender?.title || 'DSİ Yapım İşi';
      const iknLabel = primaryTender?.ikn || (c.taxId || '').replace('EKAP-İKN-', '');
      const contractVol = prof.totalWonVolume || prof.totalBidVolume || (primaryTender?.approxCost || 0);

      const dsiUrl = c.dsiSourceUrl || c.officialSourceUrl || 'https://dsi.gov.tr';
      const webSearchUrl = c.webSearchSource || c.officialSourceUrl || dsiUrl;

      return `
        <tr>
          <td>
            <div style="font-weight:700; color:var(--corp-navy);">${this.escapeHtml(c.shortName || c.name)}</div>
            <div style="font-size:11px; color:var(--text-muted);">${this.escapeHtml(c.name)} • ${this.escapeHtml(c.hqCity || '')}</div>
          </td>
          <td>
            <span class="badge badge-verified" style="font-size:10.5px;">${this.escapeHtml(regionId)}</span>
            <div style="font-size:11.5px; color:var(--text-secondary); margin-top:3px;">${this.escapeHtml(branchLabel)}</div>
          </td>
          <td style="max-width:290px;">
            <div style="font-size:12px; font-weight:600; color:var(--text-primary);">${this.escapeHtml(projectTitle)}</div>
            <div style="font-size:11px; color:#1d4ed8; font-family:monospace; margin-top:2px;">İKN: ${this.escapeHtml(iknLabel || '-')}</div>
          </td>
          <td style="white-space:nowrap;">
            <div style="font-weight:700; color:#15803d;">${contractVol > 0 ? this.formatMillionsTL(contractVol) : 'İlan / Yapım'}</div>
            <div style="font-size:11px; color:var(--text-muted);">${prof.verifiedTenderCount} Doğrulanmış İş</div>
          </td>
          <td>
            <span class="badge badge-blue">%${prof.expectedDiscountPct.toFixed(2)}</span>
          </td>
          <td style="white-space:nowrap;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <a href="${this.escapeHtml(dsiUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="font-size:11px; padding:2px 8px; text-decoration:none; text-align:center;">
                DSİ Bölge Sayfası
              </a>
              <a href="${this.escapeHtml(webSearchUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="font-size:11px; padding:2px 8px; text-decoration:none; text-align:center;">
                İnternet / İKN Kaynağı
              </a>
            </div>
          </td>
          <td style="white-space:nowrap;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              <button class="btn btn-secondary btn-sm" style="font-size:11px;" onclick="App.openCompetitorDetailFromDashboard('${c.id}')">
                Detay
              </button>
              <button class="btn btn-primary btn-sm" style="font-size:11px;" onclick="App.openSimulatorForDsiCompetitor('${regionId}', '${subeId}')">
                Teklif Hesapla
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openSimulatorForDsiCompetitor(regionId, subeId) {
    const simRegion = document.getElementById('simRegion');
    if (simRegion && regionId) {
      simRegion.value = regionId;
      this.populateSimBranches();
    }
    const simBranch = document.getElementById('simBranch');
    if (simBranch && subeId && subeId !== 'ALL') {
      const opt = Array.from(simBranch.options).find(o => o.value === subeId);
      if (opt) simBranch.value = subeId;
    }
    const btn = document.querySelector('[data-tab="tab-simulator"]');
    this.switchTab('tab-simulator', btn);
    this.onSimParamsChanged();
    this.runMonteCarloSimulation();
  },

  selectCompetitor(compId) {
    this.selectedCompetitorId = compId;
    this.renderCompetitorsTab();
  },

  renderSelectedCompetitorDetail() {
    const container = document.getElementById('competitorDetailContent');
    if (!container || !this.db) return;

    const comp = this.db.competitors.find(c => c.id === this.selectedCompetitorId);
    if (!comp) return;

    const tenders = this.getActiveVerifiedTenders();
    const prof = CompetitorPredictionEngine.analyzeCompetitor(comp, tenders, {
      regionId: (comp.primaryRegions && comp.primaryRegions[0]) || 'DSI-11',
      workGroup: (comp.workGroups && comp.workGroups[0]) || 'A/III',
      approxCost: 250000000,
      nCoeff: 1.20
    });

    const signalOptionsHtml = SIGNAL_TYPES.map(st =>
      `<option value="${st.code}">${st.label} (İndirim Etkisi: ${st.discountShift > 0 ? '+' : ''}${st.discountShift}%)</option>`
    ).join('');

    const officialSourceOptionsHtml = (typeof OFFICIAL_SOURCE_TYPES !== 'undefined')
      ? OFFICIAL_SOURCE_TYPES.map(s => `<option value="${s.code}">${s.label}</option>`).join('')
      : `<option value="KIK_KARAR">Kamu İhale Kurulu (KİK) Resmi Uyuşmazlık Kararı (kik.gov.tr)</option>`;

    const signalsListHtml = (comp.signals || []).length === 0
      ? `<div style="color:var(--text-muted); font-size:12.5px; padding:8px 0;">Bu firma için kayıtlı ek şantiye/sicil durum bilgisi bulunmamaktadır.</div>`
      : (comp.signals || []).map(s => {
          const meta = SIGNAL_TYPES.find(x => x.code === s.type);
          const shift = s.customDiscountShift ?? (meta ? meta.discountShift : 0);
          return `
            <div style="padding:10px 12px; border-radius:6px; background:#f8fafc; border:1px solid var(--border-color); margin-bottom:8px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                <div>
                  <span class="badge ${shift >= 0 ? 'badge-rose' : 'badge-amber'}">
                    ${meta ? meta.label : s.type} (İndirim Oranına Etkisi: ${shift >= 0 ? '+' : ''}${shift}%)
                  </span>
                  <div style="font-size:13px; color:var(--text-primary); margin-top:5px;">${s.note}</div>
                  <div style="font-size:11.5px; color:#1e40af; margin-top:3px;">
                    Resmi Belge Kaynağı: <strong>${s.source}</strong> • Bölge: <strong>${this.getRegionName(s.regionId)}</strong> • Tarih: ${s.date}
                  </div>
                </div>
                <button class="btn btn-danger btn-sm" onclick="App.deleteCompetitorSignal('${comp.id}', '${s.id}')">Kaldır</button>
              </div>
            </div>
          `;
        }).join('');

    const regionalBreakdownHtml = (prof.regionalBreakdown || []).length === 0
      ? `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Kayıtlı bölge faaliyeti bulunmamaktadır.</td></tr>`
      : (prof.regionalBreakdown || []).map(rb => `
          <tr>
            <td>
              <strong style="color:var(--corp-navy);">${rb.regionName}</strong>
            </td>
            <td>
              <span class="badge ${rb.winCount > 0 ? 'badge-verified' : 'badge-blue'}">${rb.dominanceStatus}</span>
            </td>
            <td><strong>${rb.tenderCount}</strong> İhale (<strong>${rb.winCount}</strong> Kazanılan)</td>
            <td>
              <strong style="color:#b45309;">${this.formatDiscountText(rb.avgDiscountPct)}</strong>
              <div style="font-size:11px; color:var(--text-muted);">SD Farkı: ${rb.avgRelToSdPct >= 0 ? '+' : ''}%${rb.avgRelToSdPct.toFixed(2)}</div>
            </td>
            <td>
              <span style="font-weight:700;">${rb.wonVolumeTL > 0 ? this.formatTL(rb.wonVolumeTL) : (rb.totalBidVolumeTL > 0 ? this.formatTL(rb.totalBidVolumeTL) : '-')}</span>
              <div style="margin-top:3px;">
                <button class="btn btn-secondary btn-sm" style="padding:2px 7px; font-size:11px;" onclick="App.openRegionFromCompetitor('${rb.regionId}')">Bölge Analizine Git</button>
              </div>
            </td>
          </tr>
        `).join('');

    const branchBreakdownHtml = (prof.branchBreakdown || []).length === 0
      ? `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Kayıtlı DSİ şube faaliyeti bulunmamaktadır.</td></tr>`
      : (prof.branchBreakdown || []).map(bb => `
          <tr>
            <td>
              <strong style="color:var(--corp-navy);">${bb.subeName}</strong>
              <div style="font-size:11px; color:var(--text-muted);">${bb.regionId} • Merkez: ${bb.city}</div>
            </td>
            <td><span class="badge ${bb.winCount > 0 ? 'badge-verified' : 'badge-blue'}">${bb.branchStatus}</span></td>
            <td><strong>${bb.tenderCount}</strong> İhale (<strong>${bb.winCount}</strong> Kazanılan)</td>
            <td><strong style="color:#b45309;">${this.formatDiscountText(bb.avgDiscountPct)}</strong></td>
            <td>
              <button class="btn btn-secondary btn-sm" style="padding:2px 7px; font-size:11px;" onclick="App.openRegionFromCompetitor('${bb.regionId}', '${bb.subeId}')">Şubeyi İncele</button>
            </td>
          </tr>
        `).join('');

    const historyHtml = prof.history.length === 0
      ? `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Bu firmanın kayıtlı ihale teklifi bulunmamaktadır.</td></tr>`
      : prof.history.map(h => `
          <tr>
            <td>
              <strong style="color:#1d4ed8;">İKN: ${h.ikn}</strong>
              <div style="font-size:11.5px; color:var(--text-muted);">${h.date}</div>
            </td>
            <td>
              <div style="font-weight:600;">${h.title}</div>
              <div style="font-size:11px; color:#1e40af; font-weight:600;">${this.getRegionName(h.regionId)}${h.subeName ? ` • ${h.subeName}` : ''}</div>
            </td>
            <td style="font-weight:600;">${this.formatTL(h.bidAmount)}</td>
            <td><strong style="color:#b45309;">%${h.discountPct.toFixed(2)}</strong></td>
            <td>
              <span class="badge ${h.isWinner ? 'badge-verified' : (h.belowSD ? 'badge-rose' : 'badge-blue')}">
                ${h.isWinner ? 'İhaleyi Kazandı (Sözleşme)' : (h.belowSD ? 'Sınır Değer Altı' : `Sınır Değerin +%${h.relToSdPct.toFixed(2)} Üzeri`)}
              </span>
            </td>
          </tr>
        `).join('');

    container.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">${comp.name} — Resmi Firma Detay ve Teklif Analizi</div>
          <div style="font-size:12px; color:#1e40af; font-weight:600; margin-top:2px;">
            Resmi Doğrulama Kaynağı: ${comp.verificationSource || 'Kamu İhale Kurulu / EKAP Resmi Kaydı'}
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
            Merkez: ${comp.hqCity} • Teklif Eğilimi: <strong style="color:#1d4ed8;">${prof.archetype}</strong>
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary btn-sm" onclick="App.openOfficialKikDecisionsPortal()">KİK Kurul Kararı Sorgula</button>
          <button class="btn btn-secondary btn-sm" onclick="App.openOfficialEkapPortal()">EKAP İhale Sorgula</button>
        </div>
      </div>

      ${comp.notes ? `<div style="background:#f0fdf4; border:1px solid #86efac; color:#14532d; padding:10px 12px; border-radius:6px; font-size:12.5px; margin-bottom:14px;"><strong>Resmi İhale Özeti:</strong> ${comp.notes}</div>` : ''}

      <div class="form-row-3" style="margin-bottom:14px;">
        <div style="background:#f8fafc; padding:12px; border-radius:6px; border:1px solid var(--border-color);">
          <div style="font-size:11.5px; color:var(--text-secondary); font-weight:600;">Geçmiş Ortalama İndirimi</div>
          <div style="font-size:19px; font-weight:800; color:var(--corp-navy); margin-top:2px;">%${prof.historicalMeanDiscountPct.toFixed(2)}</div>
          <div style="font-size:11.5px; color:var(--text-muted);">±%${prof.historicalStdDiscountPct.toFixed(2)} Sapma Aralığı</div>
        </div>
        <div style="background:#f8fafc; padding:12px; border-radius:6px; border:1px solid var(--border-color);">
          <div style="font-size:11.5px; color:var(--text-secondary); font-weight:600;">Sınır Değere Göre Farkı</div>
          <div style="font-size:19px; font-weight:800; color:#15803d; margin-top:2px;">${prof.relToSdMeanPct >= 0 ? '+' : ''}%${prof.relToSdMeanPct.toFixed(2)}</div>
          <div style="font-size:11.5px; color:var(--text-muted);">Sınır Değere Ortalama Uzaklık</div>
        </div>
        <div style="background:#eff6ff; padding:12px; border-radius:6px; border:1px solid #93c5fd;">
          <div style="font-size:11.5px; color:#1e40af; font-weight:700;">Güncel Beklenen İndirimi</div>
          <div style="font-size:19px; font-weight:800; color:#1d4ed8; margin-top:2px;">%${prof.expectedDiscountPct.toFixed(2)}</div>
          <div style="font-size:11.5px; color:var(--text-secondary);">Şantiye Durum Etkisi: ${prof.signalDiscountShift >= 0 ? '+' : ''}%${prof.signalDiscountShift.toFixed(2)}</div>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:13.5px; font-weight:700; margin-bottom:8px; color:var(--corp-navy);">
          Firmanın İş Yaptığı DSİ Bölge Müdürlükleri ve Bölgesel Teklif Analizi
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DSİ Bölge Müdürlüğü</th>
                <th>Bölgedeki Konumu</th>
                <th>İhale / Kazanma</th>
                <th>Bölge Ort. İndirimi</th>
                <th>Sözleşme / Teklif Hacmi</th>
              </tr>
            </thead>
            <tbody>${regionalBreakdownHtml}</tbody>
          </table>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:13.5px; font-weight:700; margin-bottom:8px; color:var(--corp-navy);">
          Firmanın İş Yaptığı DSİ Şube Müdürlükleri Kırılımı
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DSİ Şube Müdürlüğü</th>
                <th>Şubedeki Konumu</th>
                <th>İhale / Kazanma</th>
                <th>Şube Ort. İndirimi</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>${branchBreakdownHtml}</tbody>
          </table>
        </div>
      </div>

      <div class="form-group" style="background:#f8fafc; padding:12px; border-radius:6px; border:1px solid var(--border-color);">
        <label style="display:flex; justify-content:space-between;">
          <span>Firmanın Mevcut Şantiye / İş Yükü Doluluk Oranı (%):</span>
          <strong style="color:#1d4ed8;" id="compSatValLabel">%${comp.capacitySaturationPct}</strong>
        </label>
        <input type="range" min="0" max="100" step="5" value="${comp.capacitySaturationPct}"
          oninput="document.getElementById('compSatValLabel').textContent='%' + this.value"
          onchange="App.updateCompetitorSaturation('${comp.id}', this.value)">
        <span class="field-hint">Not: Şantiye doluluğu düşük (%0-%35) olan firmalar yeni iş almak için daha yüksek indirim yapar; doluluğu yüksek (%75+) olanlar daha yüksek fiyat verir.</span>
      </div>

      <div style="margin-top:16px; margin-bottom:16px;">
        <div style="font-size:13.5px; font-weight:700; margin-bottom:8px; color:var(--corp-navy);">
          Firmaya Ait Resmi KİK Kararı, EKAP Sözleşme ve Ticaret Sicil Kayıtları
        </div>
        ${signalsListHtml}

        <div style="background:#f8fafc; padding:14px; border-radius:6px; border:1px solid var(--border-color); margin-top:10px;">
          <div style="font-size:12.5px; font-weight:700; color:var(--corp-navy); margin-bottom:8px;">+ Firmaya Yeni Resmi Kaynaklı Durum Bilgisi Ekle</div>
          <div class="form-row-2">
            <div class="form-group">
              <label>Durum Türü</label>
              <select id="newSigType">${signalOptionsHtml}</select>
            </div>
            <div class="form-group">
              <label>Resmi Veri Kaynağı Kurumu *</label>
              <select id="newSigSourceType">${officialSourceOptionsHtml}</select>
            </div>
          </div>
          <div class="form-row-2">
            <div class="form-group">
              <label>Resmi Belge / İKN / KİK Karar No (Zorunlu) *</label>
              <input type="text" id="newSigSource" placeholder="Örn: KİK Karar No: 2024/UY.II-553 veya İKN: 2023/1241906">
            </div>
            <div class="form-group">
              <label>Resmi Kayıt Özeti / Açıklama *</label>
              <input type="text" id="newSigNote" placeholder="Örn: İKN 2023/1241906 ihalesinde sözleşme imzalandı">
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="App.addCompetitorSignal('${comp.id}')">
            Resmi Kaynaklı Durum Bilgisini Kaydet ve Hesaplamaya Dahil Et
          </button>
        </div>
      </div>

      <div>
        <div style="font-size:13.5px; font-weight:700; margin-bottom:8px; color:var(--corp-navy);">Firmanın Resmi KİK Kararları ve EKAP İlanlarında Yer Alan DSİ İhale Teklifleri</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Resmi İKN ve Tarih</th>
                <th>DSİ İhale Adı ve Bölgesi</th>
                <th>Resmi Teklif Tutarı</th>
                <th>İndirim (%)</th>
                <th>Resmi İhale Sonucu</th>
              </tr>
            </thead>
            <tbody>${historyHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  },

  openRegionFromCompetitor(regionId, subeId) {
    this.selectedRegionalAnalysisId = regionId;
    this.selectedRegionalBranchFilter = subeId || 'ALL';
    const btn = document.querySelector('[data-tab="tab-regional"]');
    this.switchTab('tab-regional', btn);
    this.renderRegionalAnalysisTab();
  },

  // =========================================================================
  // 5.B. BÖLÜM 4: DSİ BÖLGE VE ŞUBE MÜDÜRLÜKLERİNE GÖRE RAKİP ANALİZİ
  // =========================================================================
  selectRegionalAnalysisRegion(regionId) {
    if (!regionId) return;
    this.selectedRegionalAnalysisId = regionId;
    this.selectedRegionalBranchFilter = 'ALL';
    this.renderRegionalAnalysisTab();
  },

  selectRegionalBranchFilter(subeId) {
    this.selectedRegionalBranchFilter = (this.selectedRegionalBranchFilter === subeId || !subeId) ? 'ALL' : subeId;
    this.renderRegionalAnalysisTab();
  },

  openSimulatorForSelectedRegion(regionIdOverride, subeIdOverride) {
    const regId = regionIdOverride || this.selectedRegionalAnalysisId || 'DSI-20';
    const simRegSel = document.getElementById('simRegion');
    if (simRegSel) {
      simRegSel.value = regId;
      this.populateSimBranches();
    }
    const simBranchSel = document.getElementById('simBranch');
    if (simBranchSel && subeIdOverride && subeIdOverride !== 'ALL') {
      simBranchSel.value = subeIdOverride;
    }
    const simTitle = document.getElementById('simTitle');
    if (simTitle) {
      const bName = (subeIdOverride && subeIdOverride !== 'ALL') ? this.getBranchName(subeIdOverride) : this.getRegionName(regId);
      simTitle.value = `${bName} Yeni Yapım İhalesi`;
    }
    const btn = document.querySelector('[data-tab="tab-simulator"]');
    this.switchTab('tab-simulator', btn);
    this.runMonteCarloSimulation();
  },

  renderRegionalAnalysisTab() {
    if (!this.db || typeof RegionalAnalysisEngine === 'undefined') return;

    const tenders = this.getActiveVerifiedTenders();
    const regSummary = RegionalAnalysisEngine.analyzeAllRegions(this.db.competitors, tenders);

    // 1. Üst KPI Kartlarını Güncelle
    const elActiveCount = document.getElementById('regKpiActiveCount');
    if (elActiveCount) {
      elActiveCount.textContent = `${regSummary.activeRegionCount} Bölge / ${regSummary.activeBranchCount || 0} Şube`;
    }
    const elActiveSub = document.getElementById('regKpiActiveSub');
    if (elActiveSub) {
      elActiveSub.textContent = `Toplam ${tenders.length} Resmi İhale ve ${this.db.competitors.length} Müteahhit Firma`;
    }

    const elHighDisc = document.getElementById('regKpiHighDisc');
    const elHighDiscSub = document.getElementById('regKpiHighDiscSub');
    if (elHighDisc && regSummary.highestDiscountRegion) {
      const hr = regSummary.highestDiscountRegion;
      elHighDisc.textContent = `${hr.regionId} (%${hr.avgSdDiscountPct.toFixed(2)} SD İndirimi)`;
      if (elHighDiscSub) elHighDiscSub.textContent = `${hr.regionName} — Kazanan Ort. İndirim: %${Math.max(0, hr.avgWinnerDiscountPct).toFixed(2)}`;
    }

    const elLowDisc = document.getElementById('regKpiLowDisc');
    const elLowDiscSub = document.getElementById('regKpiLowDiscSub');
    if (elLowDisc && regSummary.lowestDiscountRegion) {
      const lr = regSummary.lowestDiscountRegion;
      elLowDisc.textContent = `${lr.regionId} (%${lr.avgSdDiscountPct.toFixed(2)} SD İndirimi)`;
      if (elLowDiscSub) elLowDiscSub.textContent = `${lr.regionName} — Sınır değerin en yüksek oluştuğu bölge`;
    }

    const elMultiComp = document.getElementById('regKpiMultiComp');
    const elMultiCompSub = document.getElementById('regKpiMultiCompSub');
    if (elMultiComp) {
      elMultiComp.textContent = `${regSummary.multiRegionCompetitorCount} Firma`;
      if (elMultiCompSub) {
        const names = regSummary.multiRegionCompetitors.map(c => c.shortName).join(', ');
        elMultiCompSub.textContent = names || 'Birden fazla DSİ bölgesinde iş yapan firmalar';
      }
    }

    // 2. Seçili Bölgeyi Belirle
    if (!this.selectedRegionalAnalysisId && regSummary.activeRegions.length > 0) {
      this.selectedRegionalAnalysisId = regSummary.activeRegions[0].regionId;
    }

    const regSelect = document.getElementById('regionalTabSelect');
    if (regSelect) {
      regSelect.value = this.selectedRegionalAnalysisId;
    }

    // 3. Hızlı Bölge Butonlarını Oluştur (Aktif bölgeler öncelikli)
    const quickBtnsContainer = document.getElementById('regionalQuickButtons');
    if (quickBtnsContainer) {
      quickBtnsContainer.innerHTML = regSummary.activeRegions.map(r => {
        const isSel = r.regionId === this.selectedRegionalAnalysisId;
        return `
          <button class="btn ${isSel ? 'btn-primary' : 'btn-secondary'} btn-sm"
            onclick="App.selectRegionalAnalysisRegion('${r.regionId}')">
            ${r.regionName} (${r.competitorCount} Rakip • ${r.tenderCount} İhale)
          </button>
        `;
      }).join('');
    }

    // 4. Seçili Bölge Detay Raporunu Oluştur
    const selectedReg = regSummary.allRegions.find(r => r.regionId === this.selectedRegionalAnalysisId)
      || regSummary.activeRegions[0]
      || regSummary.allRegions[0];

    if (selectedReg) {
      const adviceBox = document.getElementById('regionalStrategicAdviceBox');
      if (adviceBox) {
        const formattedAdvice = selectedReg.strategicAdvice.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        adviceBox.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
            <div style="flex:1; min-width:280px;">
              <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                <span style="font-size:15px; font-weight:800; color:var(--corp-navy);">${selectedReg.regionName} — Bölgesel Rekabet ve Teklif Analizi Raporu</span>
                <span class="badge ${selectedReg.competitionBadge}">${selectedReg.competitionLabel}</span>
              </div>
              <div style="font-size:13px; color:var(--text-primary); line-height:1.65;">
                ${formattedAdvice}
              </div>
            </div>
            <div style="background:#ffffff; border:1px solid #93c5fd; border-radius:6px; padding:10px 14px; min-width:240px; text-align:right;">
              <div style="font-size:11px; font-weight:700; color:#1e40af; text-transform:uppercase;">Bu Bölge İçin Önerilen İdeal İndirim Bandı</div>
              <div style="font-size:20px; font-weight:800; color:#15803d; margin-top:2px;">
                %${selectedReg.recommendedDiscountBand[0].toFixed(2)} – %${selectedReg.recommendedDiscountBand[1].toFixed(2)}
              </div>
              <div style="font-size:11.5px; color:var(--text-secondary);">
                Bölge Ort. Sınır Değer İndirimi: <strong>%${selectedReg.avgSdDiscountPct.toFixed(2)}</strong>
              </div>
            </div>
          </div>
        `;
      }

      const branchReports = selectedReg.branchReports || [];
      const activeBranchFilter = (this.selectedRegionalBranchFilter && this.selectedRegionalBranchFilter !== 'ALL' &&
        branchReports.some(br => br.subeId === this.selectedRegionalBranchFilter))
        ? this.selectedRegionalBranchFilter
        : 'ALL';

      const branchTitle = document.getElementById('regionalBranchTableTitle');
      if (branchTitle) {
        const activeBranchesCnt = branchReports.filter(b => b.isActive).length;
        branchTitle.textContent = `${selectedReg.regionName} Bağlı DSİ Şube Müdürlükleri (${branchReports.length} Şube • ${activeBranchesCnt} Şubede Resmi Kayıt)`;
      }

      const branchFilterBadge = document.getElementById('regionalBranchFilterBadge');
      if (branchFilterBadge) {
        branchFilterBadge.innerHTML = activeBranchFilter !== 'ALL'
          ? `<span class="badge badge-verified">Seçili Şube: ${this.getBranchName(activeBranchFilter)}</span>
             <button class="btn btn-secondary btn-sm" onclick="App.selectRegionalBranchFilter('ALL')">Tüm Şubeleri Göster</button>`
          : `<span style="font-size:11.5px; color:var(--text-muted);">Şubeye tıklayarak aşağıdaki rakip ve ihale listesini şube bazında süzebilirsiniz</span>`;
      }

      const branchTbody = document.getElementById('regionalBranchesTableBody');
      if (branchTbody) {
        if (branchReports.length === 0) {
          branchTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:12px;">Bu bölge için tanımlı şube müdürlüğü bulunmamaktadır.</td></tr>`;
        } else {
          const sortedBranches = [...branchReports].sort((a, b) => (b.tenderCount - a.tenderCount) || (b.competitorCount - a.competitorCount));
          branchTbody.innerHTML = sortedBranches.map(br => {
            const isSelBr = br.subeId === activeBranchFilter;
            const compPills = br.competitors.length > 0
              ? br.competitors.slice(0, 4).map(c =>
                  `<span class="badge ${c.branchWinCount > 0 ? 'badge-verified' : 'badge-blue'}" style="margin:1px; font-size:10.5px;">${c.shortName}</span>`
                ).join(' ') + (br.competitors.length > 4 ? ` <span style="font-size:11px; color:var(--text-muted);">+${br.competitors.length - 4}</span>` : '')
              : `<span style="font-size:11.5px; color:var(--text-muted);">KİK / DSİ kaydı izleniyor</span>`;

            return `
              <tr style="${isSelBr ? 'background:#dbeafe;' : ''}">
                <td>
                  <strong style="color:var(--corp-navy);">${br.subeName}</strong>
                  <div style="font-size:11px; color:var(--text-muted);">Şube Kodu: ${br.subeCode}</div>
                </td>
                <td>${br.city}</td>
                <td><strong>${br.tenderCount}</strong> Resmi İhale</td>
                <td style="max-width:260px;">${compPills}</td>
                <td>
                  ${br.tenderCount > 0
                    ? `<strong style="color:#b45309;">%${br.avgSdDiscountPct.toFixed(2)}</strong>`
                    : '<span style="color:var(--text-muted);">-</span>'}
                </td>
                <td>
                  <strong style="color:#15803d;">%${br.recommendedDiscountBand[0].toFixed(2)} – %${br.recommendedDiscountBand[1].toFixed(2)}</strong>
                </td>
                <td>
                  <div style="display:flex; gap:5px;">
                    <button class="btn ${isSelBr ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="App.selectRegionalBranchFilter('${br.subeId}')">
                      ${isSelBr ? 'Filtre Aktif' : 'Şubeyi Süz'}
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="App.openSimulatorForSelectedRegion('${selectedReg.regionId}', '${br.subeId}')">Teklif Hesapla</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');
        }
      }

      const activeBranchReport = activeBranchFilter !== 'ALL'
        ? branchReports.find(br => br.subeId === activeBranchFilter)
        : null;

      const filteredRegComps = activeBranchReport
        ? selectedReg.competitors.filter(c => activeBranchReport.competitors.some(bc => bc.competitorId === c.competitorId))
        : selectedReg.competitors;

      const filteredRegTenders = activeBranchFilter !== 'ALL'
        ? selectedReg.tenders.filter(t => t.subeId === activeBranchFilter)
        : selectedReg.tenders;

      const compTitle = document.getElementById('regionalCompTableTitle');
      if (compTitle) {
        const unitLabel = activeBranchReport ? activeBranchReport.subeName : selectedReg.regionName;
        compTitle.textContent = `${unitLabel} Alanında İş Yapan Rakip Firmalar (${filteredRegComps.length} Firma)`;
      }

      const compTbody = document.getElementById('regionalCompetitorsTableBody');
      if (compTbody) {
        if (filteredRegComps.length === 0) {
          compTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:16px;">Seçilen birim için henüz kayıtlı rakip firma bulunmamaktadır.</td></tr>`;
        } else {
          compTbody.innerHTML = filteredRegComps.map(c => `
            <tr>
              <td>
                <div style="font-weight:700; color:var(--corp-navy);">${c.competitorName}</div>
                <div style="font-size:11.5px; color:var(--text-muted);">Merkez: ${c.hqCity} • İş Grupları: ${(c.workGroups || []).join(', ')}</div>
              </td>
              <td>
                <span class="badge ${c.regionWinCount > 0 ? 'badge-verified' : 'badge-blue'}">${c.dominanceStatus}</span>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Şantiye Yükü: %${c.capacitySaturationPct}</div>
              </td>
              <td>
                <strong>${c.regionTenderCount}</strong> İhale<br>
                <span style="color:#15803d; font-weight:700;">${c.regionWinCount} Kazanılan Sözleşme</span>
              </td>
              <td>
                <div style="font-weight:800; color:#b45309; font-size:14px;">${this.formatDiscountText(c.regionAvgDiscountPct)}</div>
                <div style="font-size:11px; color:var(--text-muted);">SD Farkı: ${c.regionAvgRelToSdPct >= 0 ? '+' : ''}%${c.regionAvgRelToSdPct.toFixed(2)}</div>
              </td>
              <td style="font-weight:700;">
                ${c.regionWonVolumeTL > 0 ? this.formatTL(c.regionWonVolumeTL) : (c.regionTotalBidVolumeTL > 0 ? this.formatTL(c.regionTotalBidVolumeTL) : '-')}
              </td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="App.openCompetitorDetailFromDashboard('${c.competitorId}')">
                  Firma Detayı
                </button>
              </td>
            </tr>
          `).join('');
        }
      }

      const tenderTitle = document.getElementById('regionalTenderTableTitle');
      if (tenderTitle) {
        const unitLabel = activeBranchReport ? activeBranchReport.subeName : selectedReg.regionName;
        tenderTitle.textContent = `${unitLabel} Resmi KİK / EKAP İhale Kayıtları (${filteredRegTenders.length} İhale)`;
      }

      const tenderTbody = document.getElementById('regionalTendersTableBody');
      if (tenderTbody) {
        if (filteredRegTenders.length === 0) {
          tenderTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">Seçilen birim için kayıtlı resmi ihale bulunmamaktadır.</td></tr>`;
        } else {
          tenderTbody.innerHTML = filteredRegTenders.map(t => {
            const sdDisc = ((t.approxCost - t.reportedBoundaryValue) / t.approxCost) * 100;
            const winBid = (t.bids || []).find(b => b.competitorId === t.winnerCompetitorId) || (t.bids || [])[0];
            const winDisc = winBid ? (((t.approxCost - winBid.amount) / t.approxCost) * 100).toFixed(2) : '-';
            const winName = t.winnerCompetitorId ? this.getCompetitorName(t.winnerCompetitorId) : '-';

            return `
              <tr>
                <td>
                  <strong style="color:#1d4ed8;">İKN: ${t.ikn}</strong>
                  <div style="font-size:11px; color:var(--text-muted);">${t.date}</div>
                  ${t.kikDecisionNo ? `<div style="font-size:10.5px; color:#15803d; font-weight:700;">KİK: ${t.kikDecisionNo}</div>` : ''}
                </td>
                <td>
                  <div style="font-weight:600;">${t.title}</div>
                  <div style="font-size:11px; color:var(--text-muted);">${t.subeName ? `<strong style="color:#1e40af;">${t.subeName}</strong> • ` : ''}İş Grubu: ${t.workGroup}</div>
                </td>
                <td style="font-weight:600;">${this.formatTL(t.approxCost)}</td>
                <td>
                  <strong style="color:#b45309;">${this.formatTL(t.reportedBoundaryValue)}</strong>
                  <div style="font-size:11px; color:var(--text-muted);">%${sdDisc.toFixed(2)} İndirim</div>
                </td>
                <td>
                  <span class="badge badge-verified">${winName}</span>
                  <div style="font-size:11px; color:#15803d; font-weight:700; margin-top:2px;">%${winDisc} İndirim</div>
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    }

    // 5. Tüm DSİ Bölgeleri Karşılaştırma Matrisini Doldur
    const matrixBody = document.getElementById('allRegionsMatrixBody');
    if (matrixBody) {
      matrixBody.innerHTML = regSummary.activeRegions.map(r => {
        const compBadges = r.competitors.map(c =>
          `<span class="badge ${c.regionWinCount > 0 ? 'badge-verified' : 'badge-blue'}" style="margin:2px; cursor:pointer;" onclick="App.openCompetitorDetailFromDashboard('${c.competitorId}')" title="Ort. Teklif: ${this.formatDiscountText(c.regionAvgDiscountPct)}">${c.shortName} (${this.formatDiscountText(c.regionAvgDiscountPct)})</span>`
        ).join(' ');

        return `
          <tr style="${r.regionId === this.selectedRegionalAnalysisId ? 'background:#eff6ff;' : ''}">
            <td>
              <strong style="color:var(--corp-navy); font-size:13.5px;">${r.regionName}</strong>
              <div style="font-size:11.5px; color:var(--text-muted);">Merkez: ${r.city}</div>
            </td>
            <td style="max-width:340px;">
              ${compBadges || '<span style="color:var(--text-muted); font-size:12px;">Kayıtlı Rakip Yok</span>'}
            </td>
            <td>
              <strong>${r.tenderCount} Resmi İhale</strong>
              <div style="font-size:11.5px; color:var(--text-muted);">Toplam YM: ${this.formatMillionsTL(r.totalApproxCostTL)}</div>
            </td>
            <td>
              <strong style="color:#b45309; font-size:14px;">%${r.avgSdDiscountPct.toFixed(2)} İndirim</strong>
            </td>
            <td>
              <strong style="color:#1d4ed8; font-size:14px;">${this.formatDiscountText(r.avgWinnerDiscountPct)}</strong>
            </td>
            <td>
              <span style="font-weight:800; color:#15803d;">%${r.recommendedDiscountBand[0].toFixed(2)} – %${r.recommendedDiscountBand[1].toFixed(2)}</span>
            </td>
            <td>
              <span class="badge ${r.competitionBadge}">${r.competitionLabel}</span>
            </td>
            <td>
              <div style="display:flex; gap:6px;">
                <button class="btn btn-primary btn-sm" onclick="App.selectRegionalAnalysisRegion('${r.regionId}')">Bölgeyi İncele</button>
                <button class="btn btn-secondary btn-sm" onclick="App.openSimulatorForSelectedRegion('${r.regionId}')">Teklif Hesapla</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  },

  updateCompetitorSaturation(compId, newVal) {
    const comp = this.db.competitors.find(c => c.id === compId);
    if (!comp) return;
    comp.capacitySaturationPct = Number(newVal);
    this.saveDatabase();
    this.refreshAllViews();
  },

  addCompetitorSignal(compId) {
    const comp = this.db.competitors.find(c => c.id === compId);
    if (!comp) return;

    const type = document.getElementById('newSigType').value;
    const sourceTypeCode = document.getElementById('newSigSourceType')?.value || 'KIK_KARAR';
    const sourceRef = document.getElementById('newSigSource').value.trim();
    const note = document.getElementById('newSigNote').value.trim();

    if (!sourceRef || !note) {
      alert('Sadece resmi kaynaklı veri girişine izin verilmektedir. Lütfen resmi belge/İKN/KİK Karar numarasını ve açıklama notunu eksiksiz giriniz.');
      return;
    }

    const srcObj = (typeof OFFICIAL_SOURCE_TYPES !== 'undefined')
      ? OFFICIAL_SOURCE_TYPES.find(s => s.code === sourceTypeCode)
      : null;
    const fullSource = `${srcObj ? srcObj.label : 'Resmi Kaynak'} (${sourceRef})`;

    const meta = SIGNAL_TYPES.find(s => s.code === type);
    comp.signals = comp.signals || [];
    comp.signals.push({
      id: 'SIG-' + String(Date.now()).slice(-6),
      type,
      regionId: (comp.primaryRegions && comp.primaryRegions[0]) || 'DSI-11',
      date: new Date().toISOString().slice(0, 10),
      officialSourceType: sourceTypeCode,
      source: fullSource,
      verified: true,
      note,
      customPartDelta: meta ? meta.partDelta : 0,
      customDiscountShift: meta ? meta.discountShift : 0
    });

    this.saveDatabase();
    this.refreshAllViews();
  },

  deleteCompetitorSignal(compId, sigId) {
    const comp = this.db.competitors.find(c => c.id === compId);
    if (!comp || !comp.signals) return;
    comp.signals = comp.signals.filter(s => s.id !== sigId);
    this.saveDatabase();
    this.refreshAllViews();
  },

  // =========================================================================
  // 6. BÖLÜM 4: İHALE TUTANAĞI VE VERİ GİRİŞ MERKEZİ
  // =========================================================================
  initManualFormDefaults() {
    const container = document.getElementById('tFormBidsContainer');
    if (!container) return;
    container.innerHTML = '';

    // Gerçek KİK Kararı (2024/UY.II-553 — İKN 2023/1241906) örnek varsayılan teklifleri
    const defaultBids = [
      { compId: 'COMP-01', amount: 394693577 },
      { compId: 'COMP-03', amount: 414319879 },
      { compId: 'COMP-02', amount: 428500000 }
    ];

    defaultBids.forEach(b => this.addManualBidRow(b.compId, b.amount));
  },

  addManualBidRow(selectedCompId = '', amountVal = '') {
    const container = document.getElementById('tFormBidsContainer');
    if (!container || !this.db) return;

    const row = document.createElement('div');
    row.className = 'manual-bid-row';
    row.style.cssText = 'display:grid; grid-template-columns: 1fr 1fr auto; gap:10px; align-items:center;';

    const compOptions = this.db.competitors.map(c =>
      `<option value="${c.id}" ${c.id === selectedCompId ? 'selected' : ''}>${c.name}</option>`
    ).join('');

    row.innerHTML = `
      <select class="bid-comp-select" onchange="App.previewManualTenderMath()">
        ${compOptions}
      </select>
      <input type="number" class="bid-amount-input" placeholder="Teklif Tutarı (TL)" value="${amountVal}" step="100000" oninput="App.previewManualTenderMath()">
      <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove(); App.previewManualTenderMath();">Satırı Sil</button>
    `;

    container.appendChild(row);
    this.previewManualTenderMath();
  },

  collectManualFormBids() {
    const rows = document.querySelectorAll('#tFormBidsContainer .manual-bid-row');
    const bids = [];
    rows.forEach(r => {
      const compId = r.querySelector('.bid-comp-select')?.value;
      const amount = Number(r.querySelector('.bid-amount-input')?.value || 0);
      if (compId && amount > 0) {
        bids.push({ competitorId: compId, amount, isValid: true });
      }
    });
    return bids;
  },

  previewManualTenderMath() {
    const ym = Number(document.getElementById('tFormYM')?.value || 0);
    const nCoeff = Number(document.getElementById('tFormN')?.value || 1.20);
    const bids = this.collectManualFormBids();
    const sdInput = document.getElementById('tFormCalculatedSD');
    const auditBox = document.getElementById('tFormMathAuditBox');

    if (!sdInput || !auditBox) return;

    const calc = KikBoundaryEngine.calculateBoundaryValue(
      ym,
      bids.map(b => b.amount),
      nCoeff
    );

    if (!calc.valid) {
      sdInput.value = 'Hesaplanamadı';
      auditBox.innerHTML = `<span style="color:#b91c1c; font-weight:600;">Uyarı: ${calc.error}</span>`;
      return;
    }

    const roundedSD = Math.round(calc.boundaryValue);
    sdInput.value = `${this.formatTL(roundedSD)} (%${calc.boundaryDiscountPct.toFixed(2)} İndirim)`;

    const aboveSD = bids.filter(b => b.amount >= roundedSD).sort((a, b) => a.amount - b.amount);
    const winnerText = aboveSD.length > 0
      ? `${this.getCompetitorName(aboveSD[0].competitorId)} (${this.formatTL(aboveSD[0].amount)})`
      : 'Tüm teklifler sınır değerin altında kalmıştır';

    auditBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <span><strong>KİK Madde 45.1.1 Kontrolü Uygun:</strong> C = <strong>${calc.C.toFixed(3)}</strong> | K = <strong>${calc.K.toFixed(3)}</strong> | N = <strong>${calc.nCoeff.toFixed(2)}</strong></span>
        <span>1. Ortalama: <strong>${this.formatTL(calc.mean1)}</strong> | 2. Ortalama: <strong>${this.formatTL(calc.mean2)}</strong></span>
        <span>İhaleyi Kazanan (En Düşük Geçerli Teklif): <strong style="color:#15803d;">${winnerText}</strong></span>
      </div>
    `;
  },

  saveManualTender() {
    const ikn = document.getElementById('tFormIkn').value.trim();
    const date = document.getElementById('tFormDate').value;
    const sourceTypeCode = document.getElementById('tFormSourceType')?.value || 'KIK_KARAR';
    const sourceRef = document.getElementById('tFormSource').value.trim();
    const title = document.getElementById('tFormTitle').value.trim();
    const regionId = document.getElementById('tFormRegion').value;
    const workGroup = document.getElementById('tFormWorkGroup').value;
    const approxCost = Number(document.getElementById('tFormYM').value || 0);
    const nCoeff = Number(document.getElementById('tFormN').value || 1.20);
    const bids = this.collectManualFormBids();

    if (!ikn || !title || approxCost <= 0 || bids.length < 2) {
      alert('Lütfen resmi İhale Kayıt Numarası (İKN), İhale Adı, Yaklaşık Maliyet ve en az 2 geçerli teklif giriniz.');
      return;
    }

    if (!sourceRef) {
      alert('Sadece resmi kaynaklı ihale verisi eklenebilir. Lütfen Resmi Belge / KİK Kurul Karar Numarası veya EKAP İlan referansını giriniz.');
      return;
    }

    const srcObj = (typeof OFFICIAL_SOURCE_TYPES !== 'undefined')
      ? OFFICIAL_SOURCE_TYPES.find(s => s.code === sourceTypeCode)
      : null;
    const fullOfficialSource = `${srcObj ? srcObj.label : 'Resmi Kaynak'} — ${sourceRef}`;

    const calc = KikBoundaryEngine.calculateBoundaryValue(approxCost, bids.map(b => b.amount), nCoeff);
    if (!calc.valid) {
      alert('Sınır Değer hesaplama hatası: ' + calc.error);
      return;
    }

    const sd = Math.round(calc.boundaryValue);
    const validAboveSD = bids.filter(b => b.amount >= sd).sort((a, b) => a.amount - b.amount);
    const winnerId = validAboveSD.length > 0 ? validAboveSD[0].competitorId : null;

    const inferredBranch = typeof inferDsiBranch === 'function' ? inferDsiBranch(regionId, title) : null;

    const newTender = {
      id: 'T-' + ikn.replace(/[^0-9]/g, '') + '-' + String(Date.now()).slice(-3),
      ikn,
      title,
      regionId,
      subeId: inferredBranch ? inferredBranch.id : null,
      subeName: inferredBranch ? inferredBranch.name : null,
      workGroup,
      date,
      approxCost,
      nCoeff,
      reportedBoundaryValue: sd,
      evalRule: 'AUTO_REJECT',
      verificationStatus: 'VERIFIED_EKAP',
      officialSourceType: sourceTypeCode,
      officialSourceUrl: srcObj ? srcObj.url : 'https://ekap.kik.gov.tr',
      verificationSource: fullOfficialSource,
      isSampleCalibration: false,
      winnerCompetitorId: winnerId,
      bids
    };

    this.db.tenders.unshift(newTender);
    this.saveDatabase();
    this.refreshAllViews();

    document.getElementById('tFormIkn').value = '';
    document.getElementById('tFormTitle').value = '';
    alert(`Resmi İhale kaydı (${ikn}) KİK Madde 45.1.1 kontrolünden geçerek başarıyla kaydedildi.`);
  },

  loadSampleEkapText() {
    const sample = `T.C. DEVLET SU İŞLERİ 11. BÖLGE MÜDÜRLÜĞÜ (EDİRNE) — RESMİ KİK KURUL KARARI: 2024/UY.II-553
İhale Kayıt No (İKN): 2023/1241906
İhalenin Adı: Kırklareli-Kofçaz Kula 2 Göleti ve İletim Hattı İnşaatı
İhale Tarihi: 23.11.2023
Benzer İş Grubu: A/I
Açıklanan Yaklaşık Maliyet: 571.315.757,00 TL
Sınır Değer Katsayısı (N): 1,20

İHALEYE KATILAN İSTEKLİLER VE RESMİ TEKLİF BEDELLERİ:
1. Ilgazlar İnşaat Tic. ve San. A.Ş. & SMH Grup İnşaat İş Ortaklığı : 394.693.577 TL
2. Erkilet İnşaat San. ve Tic. A.Ş. & Baran Yapı İnşaat İş Ortaklığı : 414.319.878,75 TL
3. Mete Altyapı İnşaat A.Ş. : 428.500.000 TL`;

    document.getElementById('smartParserInput').value = sample;
  },

  openOfficialEkapPortal() {
    window.open('https://ekap.kik.gov.tr/EKAP/Ortak/IhaleArama/index.html', '_blank', 'noopener');
  },

  openOfficialKikDecisionsPortal() {
    window.open('https://ekap.kik.gov.tr/EKAP/Vatandas/KurulKararSorgu.aspx', '_blank', 'noopener');
  },

  runSmartParser() {
    const raw = document.getElementById('smartParserInput').value.trim();
    if (!raw) {
      alert('Lütfen okunacak resmi EKAP sonuç ilanı veya KİK Kurul Kararı metnini kutuya yapıştırınız.');
      return;
    }

    const parsed = EkapSmartParser.parseText(raw);
    if (parsed.ikn) document.getElementById('tFormIkn').value = parsed.ikn;
    if (parsed.title) document.getElementById('tFormTitle').value = parsed.title;
    if (parsed.date) document.getElementById('tFormDate').value = parsed.date;
    if (parsed.regionId) document.getElementById('tFormRegion').value = parsed.regionId;
    if (parsed.workGroup) document.getElementById('tFormWorkGroup').value = parsed.workGroup;
    if (parsed.approxCost > 0) document.getElementById('tFormYM').value = parsed.approxCost;
    if (parsed.nCoeff > 0) document.getElementById('tFormN').value = parsed.nCoeff;
    if (parsed.ikn) {
      document.getElementById('tFormSource').value = `EKAP Resmi Sonuç İlanı / KİK Tutanak Metni (İKN: ${parsed.ikn})`;
    }

    if (parsed.bids && parsed.bids.length > 0) {
      const container = document.getElementById('tFormBidsContainer');
      container.innerHTML = '';

      parsed.bids.forEach(pb => {
        const lowerName = pb.competitorName.toLowerCase();
        let matchedComp = this.db.competitors.find(c =>
          c.name.toLowerCase().includes(lowerName.slice(0, 8)) ||
          (c.shortName && lowerName.includes(c.shortName.toLowerCase().slice(0, 6)))
        );

        if (!matchedComp) {
          const newId = 'COMP-' + String(Date.now() + Math.floor(Math.random() * 999)).slice(-5);
          matchedComp = {
            id: newId,
            name: pb.competitorName,
            shortName: pb.competitorName.split(' ').slice(0, 2).join(' '),
            taxId: 'EKAP-RESMİ',
            hqCity: 'Ankara',
            primaryRegions: [parsed.regionId || 'DSI-11'],
            workGroups: [parsed.workGroup || 'A/III'],
            maxTenderCapacityTL: 1000000000,
            activeProjectCount: 2,
            capacitySaturationPct: 50,
            fduCompetencyScore: 85,
            officialSourceType: 'EKAP_SONUC',
            verificationSource: `EKAP Resmi Sonuç İlanı (İKN: ${parsed.ikn || 'Belirtildi'})`,
            signals: []
          };
          this.db.competitors.push(matchedComp);
        }

        this.addManualBidRow(matchedComp.id, pb.amount);
      });
    }

    this.switchDataSubtab('sub-manual');
    this.previewManualTenderMath();
  },

  renderDatacenterTable() {
    const tbody = document.getElementById('datacenterTendersBody');
    if (!tbody || !this.db) return;

    const tenders = this.getActiveVerifiedTenders();
    tbody.innerHTML = tenders.map(t => {
      const audit = KikBoundaryEngine.verifyTenderMath(t);
      const sdDisc = ((t.approxCost - t.reportedBoundaryValue) / t.approxCost) * 100;

      return `
        <tr>
          <td>
            <strong style="color:#1d4ed8;">${t.ikn}</strong>
            ${t.kikDecisionNo ? `<div style="font-size:11px; color:#15803d; font-weight:700;">${t.kikDecisionNo}</div>` : ''}
          </td>
          <td>${t.date}</td>
          <td>
            <div style="font-weight:600;">${t.title}</div>
            <div style="font-size:11.5px; color:var(--text-muted);">${this.getRegionName(t.regionId)} (${(t.bids || []).length} Katılımcı Firma)</div>
          </td>
          <td><span class="badge badge-blue">${t.workGroup} (N=${Number(t.nCoeff || 1.2).toFixed(2)})</span></td>
          <td style="font-weight:600;">${this.formatTL(t.approxCost)}</td>
          <td>
            <strong style="color:#b45309;">${this.formatTL(t.reportedBoundaryValue)}</strong>
            <div style="font-size:11.5px; color:var(--text-muted);">%${sdDisc.toFixed(2)} İndirim</div>
          </td>
          <td>
            <span class="badge ${audit.isMathematicallyConsistent ? 'badge-verified' : 'badge-rose'}" title="${audit.message}">
              ${audit.isMathematicallyConsistent ? 'Resmi KİK / EKAP Doğrulamalı' : 'Tutarsızlık Uyarısı'}
            </span>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
              C=${audit.details?.C?.toFixed(3) || '-'} | K=${audit.details?.K?.toFixed(3) || '-'}
            </div>
          </td>
          <td>
            <div style="font-size:11.5px; color:#1e40af; font-weight:600; margin-bottom:4px;">${t.verificationSource || 'EKAP / KİK Resmi Kaydı'}</div>
            <button class="btn btn-danger btn-sm" onclick="App.deleteTender('${t.id}')">Kaydı Sil</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  deleteTender(tenderId) {
    if (!this.db) return;
    this.db.tenders = this.db.tenders.filter(t => t.id !== tenderId);
    this.saveDatabase();
    this.refreshAllViews();
  },

  // =========================================================================
  // 7. CSV VE JSON YEDEKLEME / İÇE-DIŞA AKTARIM
  // =========================================================================
  downloadCsvTemplate() {
    const csvContent = '\uFEFFIKN;Tarih;Ihale_Adi;Bolge_Kodu;Is_Grubu;Yaklasik_Maliyet;N_Katsayisi;Firma_Adi;Teklif_TL\n' +
      '2023/1241906;2023-11-23;Kırklareli-Kofçaz Kula 2 Göleti ve İletim Hattı İnşaatı;DSI-11;A/I;571315757;1.20;Ilgazlar İnşaat Tic. ve San. A.Ş. & SMH Grup İnşaat İş Ortaklığı;394693577\n' +
      '2023/1241906;2023-11-23;Kırklareli-Kofçaz Kula 2 Göleti ve İletim Hattı İnşaatı;DSI-11;A/I;571315757;1.20;Erkilet İnşaat San. ve Tic. A.Ş. & Baran Yapı İnşaat İş Ortaklığı;414319879\n' +
      '2023/1241906;2023-11-23;Kırklareli-Kofçaz Kula 2 Göleti ve İletim Hattı İnşaatı;DSI-11;A/I;571315757;1.20;Mete Altyapı İnşaat A.Ş.;428500000\n';

    this.triggerDownload(csvContent, 'DSI_Resmi_KIK_Ihale_Aktarim_Sablonu.csv', 'text/csv;charset=utf-8;');
  },

  exportTendersCsv() {
    const tenders = this.getActiveVerifiedTenders();
    const lines = ['\uFEFFIKN;Tarih;Ihale_Adi;Bolge_Kodu;Is_Grubu;Yaklasik_Maliyet;N_Katsayisi;Sinir_Deger_TL;Firma_Adi;Teklif_TL;Indirim_Yuzde'];

    tenders.forEach(t => {
      (t.bids || []).forEach(b => {
        const compName = this.getCompetitorName(b.competitorId);
        const disc = (((t.approxCost - b.amount) / t.approxCost) * 100).toFixed(2);
        lines.push(`${t.ikn};${t.date};"${t.title}";${t.regionId};${t.workGroup};${t.approxCost};${t.nCoeff || 1.20};${t.reportedBoundaryValue};"${compName}";${b.amount};${disc}`);
      });
    });

    this.triggerDownload(lines.join('\n'), 'DSI_Dogrulanmis_Ihaleler_Arsivi.csv', 'text/csv;charset=utf-8;');
  },

  importCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return;

      const grouped = {};
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';').map(c => c.replace(/^"|"$/g, '').trim());
        if (cols.length < 9) continue;
        const [ikn, date, title, regionId, workGroup, ymStr, nStr, compName, bidStr] = cols;
        const ym = Number(ymStr);
        const nCoeff = Number(nStr.replace(',', '.')) || 1.20;
        const bidAmount = Number(bidStr);
        if (!ikn || ym <= 0 || bidAmount <= 0) continue;

        if (!grouped[ikn]) {
          grouped[ikn] = { ikn, date, title, regionId, workGroup, approxCost: ym, nCoeff, bids: [] };
        }

        let comp = this.db.competitors.find(c =>
          c.name.toLowerCase() === compName.toLowerCase() ||
          (c.shortName && c.shortName.toLowerCase() === compName.toLowerCase())
        );

        if (!comp) {
          comp = {
            id: 'COMP-' + String(Date.now() + i).slice(-5),
            name: compName,
            shortName: compName.split(' ').slice(0, 2).join(' '),
            taxId: 'CSV-KAYIT',
            hqCity: 'Ankara',
            primaryRegions: [regionId || 'DSI-05'],
            workGroups: [workGroup || 'A/III'],
            maxTenderCapacityTL: 1000000000,
            activeProjectCount: 2,
            capacitySaturationPct: 50,
            fduCompetencyScore: 85,
            verificationSource: 'Excel / CSV Toplu Aktarım',
            signals: []
          };
          this.db.competitors.push(comp);
        }

        grouped[ikn].bids.push({ competitorId: comp.id, amount: bidAmount, isValid: true });
      }

      let importedCount = 0;
      Object.values(grouped).forEach(g => {
        if (g.bids.length < 2) return;
        const calc = KikBoundaryEngine.calculateBoundaryValue(g.approxCost, g.bids.map(b => b.amount), g.nCoeff);
        if (!calc.valid) return;
        const sd = Math.round(calc.boundaryValue);
        const validAbove = g.bids.filter(b => b.amount >= sd).sort((a, b) => a.amount - b.amount);

        this.db.tenders.unshift({
          id: 'T-CSV-' + Date.now() + '-' + importedCount,
          ikn: g.ikn,
          title: g.title,
          regionId: g.regionId || 'DSI-05',
          workGroup: g.workGroup || 'A/III',
          date: g.date || new Date().toISOString().slice(0, 10),
          approxCost: g.approxCost,
          nCoeff: g.nCoeff,
          reportedBoundaryValue: sd,
          evalRule: 'AUTO_REJECT',
          verificationStatus: 'VERIFIED_EKAP',
          verificationSource: 'Excel / CSV Resmi Arşiv Aktarımı',
          isSampleCalibration: false,
          winnerCompetitorId: validAbove.length > 0 ? validAbove[0].competitorId : null,
          bids: g.bids
        });
        importedCount++;
      });

      this.saveDatabase();
      this.refreshAllViews();
      alert(`${importedCount} adet ihale kaydı KİK Madde 45.1.1 kontrolünden geçerek başarıyla sisteme aktarıldı.`);
    };
    reader.readAsText(file, 'UTF-8');
  },

  exportDatabaseJson() {
    if (!this.db) return;
    const jsonStr = JSON.stringify(this.db, null, 2);
    this.triggerDownload(jsonStr, `DSI_Ihale_Sistemi_Yedek_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  },

  importDatabaseJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed && Array.isArray(parsed.competitors) && Array.isArray(parsed.tenders)) {
          this.db = parsed;
          this.saveDatabase();
          this.refreshAllViews();
          alert('Veritabanı yedeği başarıyla geri yüklendi.');
        } else {
          alert('Geçersiz yedek dosyası formatı.');
        }
      } catch (err) {
        alert('Dosya okunamadı: ' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
  },

  triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // =========================================================================
  // 8. BÖLÜM 5: RESMİ KİK 45.1.1 SINIR DEĞER HESAPLAMA CETVELİ
  // =========================================================================
  runStandaloneKikCalc() {
    const ym = Number(document.getElementById('calcYM')?.value || 0);
    const nCoeff = Number(document.getElementById('calcN')?.value || 1.20);
    const rawBids = document.getElementById('calcBidsText')?.value || '';
    const out = document.getElementById('standaloneKikOutput');
    if (!out) return;

    const bids = rawBids
      .split(/\r?\n/)
      .map(s => EkapSmartParser.parseTurkishNumber(s))
      .filter(v => v !== null && v > 0);

    const calc = KikBoundaryEngine.calculateBoundaryValue(ym, bids, nCoeff);
    if (!calc.valid) {
      out.innerHTML = `<div style="color:#b91c1c; padding:12px; font-weight:600;">Uyarı: ${calc.error}</div>`;
      return;
    }

    const sortedBids = [...bids].sort((a, b) => a - b);
    const sd = calc.boundaryValue;

    out.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;">
        <div style="background:#eff6ff; padding:14px; border-radius:6px; border:2px solid #2563eb;">
          <div style="font-size:11.5px; color:#1e40af; font-weight:800;">HESAPLANAN RESMİ SINIR DEĞER (SD)</div>
          <div style="font-size:22px; font-weight:800; color:#0f2942; margin-top:4px;">${this.formatTL(sd)}</div>
          <div style="font-size:12.5px; color:#15803d; font-weight:700;">Yaklaşık Maliyete Göre İndirim: %${calc.boundaryDiscountPct.toFixed(2)}</div>
        </div>
        <div style="background:#f8fafc; padding:14px; border-radius:6px; border:1px solid var(--border-color);">
          <div style="font-size:11.5px; color:var(--text-secondary); font-weight:700;">TEBLİĞ KATSAYILARI (3 BASAMAK YUVARLAMALI)</div>
          <div style="font-size:15px; font-weight:800; color:#b45309; margin-top:6px;">
            C = ${calc.C.toFixed(3)} &nbsp;|&nbsp; K = ${calc.K.toFixed(3)} &nbsp;|&nbsp; N = ${calc.nCoeff.toFixed(2)}
          </div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
            Resmi Formül: SD = (K × T_ort,2) / (C × N)
          </div>
        </div>
      </div>

      <div style="font-size:12.5px; line-height:1.75; background:#f8fafc; padding:12px 14px; border-radius:6px; border:1px solid var(--border-color); margin-bottom:14px;">
        <div><strong>1. Aşama (%40 – %120 YM Aralığı Kontrolü):</strong> [${this.formatTL(calc.lowerLimit)} – ${this.formatTL(calc.upperLimit)}] aralığında <strong>${calc.stage1Count}</strong> adet geçerli teklif bulundu.</div>
        <div><strong>1. Aritmetik Ortalama (T_ort,1):</strong> ${this.formatTL(calc.mean1)} &nbsp;|&nbsp; <strong>Standart Sapma (σ):</strong> ${this.formatTL(calc.stdDev)}</div>
        <div><strong>2. Aşama (T_ort,1 ± σ Aralığı):</strong> Standart sapma aralığında kalan <strong>${calc.stage2Count}</strong> teklifin ortalaması: <strong>T_ort,2 = ${this.formatTL(calc.mean2)}</strong></div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sıra</th>
              <th>Teklif Tutarı</th>
              <th>İndirim Oranı (%)</th>
              <th>Değerlendirme Sonucu (4734 Md. 38)</th>
            </tr>
          </thead>
          <tbody>
            ${sortedBids.map((b, i) => {
              const disc = ((ym - b) / ym) * 100;
              const isBelow = b < sd;
              const isWinner = !isBelow && (i === 0 || sortedBids[i - 1] < sd);
              return `
                <tr>
                  <td>${i + 1}. Teklif</td>
                  <td style="font-weight:700;">${this.formatTL(b)}</td>
                  <td>%${disc.toFixed(2)}</td>
                  <td>
                    <span class="badge ${isWinner ? 'badge-verified' : (isBelow ? 'badge-rose' : 'badge-blue')}">
                      ${isWinner ? '1. Sıra — En Avantajlı Geçerli Teklif' : (isBelow ? 'Sınır Değerin Altında (Elendi)' : 'Geçerli Teklif')}
                    </span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  // =========================================================================
  // 9. BÖLÜM 6: PERİYODİK RESMİ VERİ TOPLAMA VE OTOMATİK SENKRONİZASYON
  // =========================================================================
  initOfficialSyncPolling() {
    this.pollOfficialSyncStatus();
    if (this.syncPollTimer) clearInterval(this.syncPollTimer);
    this.syncPollTimer = setInterval(() => {
      this.pollOfficialSyncStatus();
    }, 5000);
  },

  async pollOfficialSyncStatus() {
    try {
      const resp = await fetch('/api/sync/status', { cache: 'no-store' });
      if (!resp.ok) return;
      const status = await resp.json();

      // Eğer arka planda yeni bir senkronizasyon tamamlandıysa veritabanını sunucudan tazele
      if (status.lastSyncTime && status.lastSyncTime !== this.lastObservedSyncTimestamp) {
        this.lastObservedSyncTimestamp = status.lastSyncTime;
        await this.reloadDatabaseFromServer();
      }

      this.renderOfficialSyncPanel(status);
    } catch (_) {}
  },

  async triggerOfficialSyncNow() {
    const btnTop = document.getElementById('btnTopbarSyncNow');
    const btnMain = document.getElementById('btnSyncRunMain');
    if (btnTop) {
      btnTop.disabled = true;
      btnTop.textContent = 'Resmi Kaynaklar Taranıyor...';
    }
    if (btnMain) {
      btnMain.disabled = true;
      btnMain.textContent = 'Resmi KİK & DSİ Kaynakları Taranıyor...';
    }

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 90000);

    try {
      const resp = await fetch('/api/sync/run', { method: 'POST', signal: ctrl.signal });
      const rawText = await resp.text();
      let status = null;
      try {
        status = JSON.parse(rawText);
      } catch (_) {
        throw new Error(`Sunucudan geçersiz yanıt alındı (HTTP ${resp.status}).`);
      }

      if (!resp.ok || status?.ok === false) {
        throw new Error(status?.error || `HTTP ${resp.status} tarama hatası`);
      }

      this.lastObservedSyncTimestamp = status.lastSyncTime || '';
      await this.reloadDatabaseFromServer();
      this.renderOfficialSyncPanel(status);
    } catch (err) {
      const msg = err?.name === 'AbortError'
        ? 'Tarama zaman aşımına uğradı (90 sn). Arka plan taraması devam ediyor olabilir.'
        : (err?.message || 'Bilinmeyen bağlantı hatası');
      const elScans = document.getElementById('syncKpiTotalScans');
      if (elScans) {
        elScans.textContent = `Tarama uyarısı: ${msg}`;
        elScans.style.color = '#b91c1c';
      }
      console.warn('Resmi kaynak taraması uyarısı:', msg);
    } finally {
      clearTimeout(timeoutId);
      if (btnTop) {
        btnTop.disabled = false;
        btnTop.textContent = '↻ Resmi Kaynakları Şimdi Tara';
      }
      if (btnMain) {
        btnMain.disabled = false;
        btnMain.textContent = '↻ Şimdi Resmi Kaynakları Tara ve Veritabanını Güncelle';
      }
    }
  },

  async saveOfficialSyncConfig() {
    const autoEl = document.getElementById('syncAutoEnabledSelect');
    const intEl = document.getElementById('syncIntervalSelect');
    if (!autoEl || !intEl) return;

    const autoSyncEnabled = autoEl.value === 'true';
    const intervalMinutes = Number(intEl.value) || 30;

    try {
      const resp = await fetch('/api/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSyncEnabled, intervalMinutes })
      });
      if (resp.ok) {
        const status = await resp.json();
        this.renderOfficialSyncPanel(status);
      }
    } catch (_) {}
  },

  fillSampleOfficialUrl(url) {
    const inp = document.getElementById('syncDirectUrlInput');
    if (inp) inp.value = url;
  },

  async fetchSingleOfficialUrl() {
    const inp = document.getElementById('syncDirectUrlInput');
    const url = inp ? inp.value.trim() : '';
    if (!url) {
      alert('Lütfen geçerli bir resmi EKAP (ekap.kik.gov.tr) veya DSİ (dsi.gov.tr) bağlantısı giriniz.');
      return;
    }

    try {
      const resp = await fetch('/api/sync/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (resp.ok) {
        const status = await resp.json();
        if (status.ok === false && status.error) {
          alert(status.error);
          return;
        }
        this.lastObservedSyncTimestamp = status.lastSyncTime || '';
        await this.reloadDatabaseFromServer();
        this.renderOfficialSyncPanel(status);
        alert('Resmi bağlantı başarıyla tarandı ve veritabanı güncellendi.');
      }
    } catch (err) {
      alert('Bağlantı çekilirken hata oluştu: ' + err.message);
    }
  },

  renderOfficialSyncPanel(status) {
    if (!status) return;

    // Topbar güncellemesi
    const topText = document.getElementById('verifiedStatusText');
    if (topText) {
      const compCount = this.db?.competitors?.length || 0;
      const tendCount = this.db?.tenders?.length || 0;
      if (status.isRunning) {
        topText.textContent = 'Resmi KİK & DSİ Kaynakları Taranıyor...';
      } else if (status.lastSyncTime) {
        const shortTime = status.lastSyncTime.split(' ')[1] || status.lastSyncTime;
        topText.textContent = `Otomatik Resmi Senkron: Aktif (${tendCount} İhale / ${compCount} Firma | Son: ${shortTime})`;
      }
    }

    // KPI Kartları
    const elStatus = document.getElementById('syncKpiStatus');
    const elLast = document.getElementById('syncKpiLastTime');
    const elInterval = document.getElementById('syncKpiInterval');
    const elNext = document.getElementById('syncKpiNextTime');
    const elAdded = document.getElementById('syncKpiAddedCounts');
    const elScans = document.getElementById('syncKpiTotalScans');
    const elEndpoints = document.getElementById('syncKpiEndpoints');

    if (elStatus) {
      elStatus.textContent = status.isRunning
        ? 'Resmi Kaynaklar Taranıyor...'
        : (status.autoSyncEnabled ? 'Otomatik Tarama Aktif' : 'Manuel Mod (Duraklatıldı)');
      elStatus.style.color = status.autoSyncEnabled ? '#15803d' : '#b45309';
    }
    if (elLast) {
      elLast.textContent = status.lastSyncTime
        ? `Son Tarama: ${status.lastSyncTime}`
        : 'Son Tarama: Başlatılıyor...';
    }
    if (elInterval) {
      elInterval.textContent = status.autoSyncEnabled
        ? `Her ${status.intervalMinutes} Dakikada Bir`
        : 'Otomatik Tarama Kapalı';
    }
    if (elNext) {
      elNext.textContent = status.nextSyncTime
        ? `Sonraki Kontrol: ${status.nextSyncTime}`
        : 'Sonraki Kontrol: Manuel tetikleme bekleniyor';
    }
    if (elAdded) {
      elAdded.textContent = `+${status.totalNewTendersAdded || 0} Yeni İhale / +${status.totalNewCompetitorsAdded || 0} Yeni Firma`;
    }
    if (elScans) {
      elScans.textContent = `Toplam Gerçekleşen Tarama: ${status.totalScansRun || 0} (${status.lastSyncStatus || 'Hazır'})`;
      elScans.style.color = '';
    }
    if (elEndpoints) {
      elEndpoints.textContent = `${(status.monitoredEndpointCount || 10) + 27} Resmi Uç Nokta`;
    }

    const autoSel = document.getElementById('syncAutoEnabledSelect');
    if (autoSel && document.activeElement !== autoSel) {
      autoSel.value = status.autoSyncEnabled ? 'true' : 'false';
    }
    const intSel = document.getElementById('syncIntervalSelect');
    if (intSel && document.activeElement !== intSel) {
      intSel.value = String(status.intervalMinutes || 30);
    }

    // Resmi Kaynak Sağlık Tablosu
    const healthBody = document.getElementById('syncSourceHealthBody');
    if (healthBody && Array.isArray(status.sourceHealth)) {
      if (status.sourceHealth.length === 0) {
        healthBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:14px;">İlk resmi kaynak taraması yürütülüyor...</td></tr>`;
      } else {
        healthBody.innerHTML = status.sourceHealth.map(h => `
          <tr>
            <td>
              <div style="font-weight:700; color:var(--corp-navy);">${this.escapeHtml(h.sourceName)}</div>
              <div style="font-size:11px; color:var(--text-muted); font-family:monospace;">${this.escapeHtml(h.endpointUrl)}</div>
            </td>
            <td>
              <span class="badge ${h.httpCode === 200 ? 'badge-verified' : 'badge-amber'}">
                ${this.escapeHtml(h.status)}
              </span>
            </td>
            <td style="font-family:monospace; font-size:12px;">${this.escapeHtml(h.lastChecked)}</td>
            <td style="font-weight:700; color:#1d4ed8;">${h.itemsFound} Resmi Kayıt</td>
          </tr>
        `).join('');
      }
    }

    // DSİ Bölge Müdürlükleri ve Kamu İhale Duyuru Radarı
    const annBody = document.getElementById('syncAnnouncementsBody');
    if (annBody && Array.isArray(status.discoveredAnnouncements)) {
      if (status.discoveredAnnouncements.length === 0) {
        annBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:14px;">Resmi DSİ ve KİK duyuruları taranıyor...</td></tr>`;
      } else {
        annBody.innerHTML = status.discoveredAnnouncements.map(a => `
          <tr>
            <td style="white-space:nowrap;">
              <div style="font-weight:700; font-size:11.5px;">${this.escapeHtml(a.date)}</div>
              <span class="badge badge-blue" style="font-size:10px;">${this.escapeHtml(a.regionId)}</span>
            </td>
            <td style="font-size:12px; font-weight:600; color:var(--corp-navy);">
              ${this.escapeHtml(a.source)}
            </td>
            <td style="font-size:12px;">
              ${this.escapeHtml(a.title)}
            </td>
            <td>
              <a href="${this.escapeHtml(a.url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px; text-decoration:none;">
                Resmi Sayfa
              </a>
            </td>
          </tr>
        `).join('');
      }
    }

    // Gerçek Zamanlı Senkronizasyon Günlüğü
    const logsBody = document.getElementById('syncLogsBody');
    if (logsBody && Array.isArray(status.recentLogs)) {
      if (status.recentLogs.length === 0) {
        logsBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:14px;">Henüz senkronizasyon kaydı yok.</td></tr>`;
      } else {
        logsBody.innerHTML = status.recentLogs.map(l => {
          const badgeCls = l.level === 'SUCCESS' ? 'badge-verified' : (l.level === 'ERROR' ? 'badge-rose' : (l.level === 'WARN' ? 'badge-amber' : 'badge-blue'));
          return `
            <tr>
              <td style="font-family:monospace; font-size:11.5px; white-space:nowrap;">${this.escapeHtml(l.timestamp)}</td>
              <td>
                <span class="badge ${badgeCls}" style="font-size:10.5px;">${this.escapeHtml(l.source)}</span>
              </td>
              <td style="font-size:12px;">
                ${this.escapeHtml(l.message)}
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
