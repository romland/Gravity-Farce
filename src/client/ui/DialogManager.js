export class DialogManager {
    constructor(socket, onWatchReplay, onNextLevel, onRetryLevel, onSwitchSession) {
        this.socket = socket;
        this.onWatchReplay = onWatchReplay;
        this.onNextLevel = onNextLevel;
        this.onRetryLevel = onRetryLevel;
        this.onSwitchSession = onSwitchSession;

        this.modals = ['leaderboard-modal', 'room-modal', 'gameover-modal', 'controls-modal'];
        this.hintTimer = null;
    }

    closeAnyOpen() {
        let closed = false;
        for (const id of this.modals) {
            const el = document.getElementById(id);
            if (el && el.style.display && el.style.display !== 'none') {
                el.style.display = 'none';
                closed = true;
            }
        }
        return closed;
    }

    toggleModal(id, onOpenFn) {
        const el = document.getElementById(id);
        if (!el) return false;
        const isOpen = el.style.display && el.style.display !== 'none';
        this.closeAnyOpen();
        if (!isOpen) {
            el.style.display = 'flex';
            if (onOpenFn) onOpenFn();
            return true;
        }
        return false;
    }

    openControlsModal() {
        this.toggleModal('controls-modal');
    }

    showHintToast(hintData) {
        if (!hintData || !hintData.id) return;
        const storageKey = `gf_hint_seen_${hintData.id}`;
        if (localStorage.getItem(storageKey) === '1') return;
        localStorage.setItem(storageKey, '1');

        const toast = document.getElementById('tactical-hint-toast');
        const titleEl = document.getElementById('hint-toast-title');
        const bodyEl = document.getElementById('hint-toast-body');
        const keysEl = document.getElementById('hint-toast-keys');
        if (!toast || !titleEl || !bodyEl) return;

        titleEl.textContent = hintData.title || 'TACTICAL BRIEFING';
        bodyEl.textContent = hintData.body || '';
        if (keysEl) {
            keysEl.style.display = hintData.showKeys ? 'flex' : 'none';
        }

        toast.style.display = 'block';
        if (this.hintTimer) clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => {
            toast.style.display = 'none';
        }, 7000);
    }

    renderLeaderboard(boards, isHud, currentCategory, onRankOne) {
        const modal = document.getElementById('leaderboard-modal');
        if (!modal || !Array.isArray(boards)) return;

        const summaryRoot = document.getElementById('run-summary-container');
        const tabsRoot = document.getElementById('board-tabs-container');
        const contentRoot = document.getElementById('leaderboard-content');
        const footerRoot = document.getElementById('modal-footer');

        summaryRoot.textContent = '';
        tabsRoot.textContent = '';
        contentRoot.textContent = '';
        footerRoot.textContent = '';

        let boardIndex = 0;
        let flatteringIndex = 0;
        let bestScore = 9999;
        let top10TabIndices = [];
        let gotRankOne = false;

        boards.forEach((b) => {
            if (b.isFootnote || (b.title && b.title.includes('SUMMARY'))) return;
            let hasTop10InTab = false;
            (b.entries || []).forEach(e => {
                if (e.isMe && (e.isCurrentRun || !isHud)) {
                    const parsed = e.rank ?? parseInt(String(e.rankLabel).replace('#', ''), 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
                        hasTop10InTab = true;
                        if (parsed === 1 && e.isCurrentRun) gotRankOne = true;
                    }
                }
            });
            if (hasTop10InTab) top10TabIndices.push(boardIndex);
            boardIndex++;
        });

        const shouldHighlightTop10Tabs = !isHud && top10TabIndices.length > 0 && top10TabIndices.length <= 2;
        boardIndex = 0;

        boards.forEach((b) => {
            if (b.isFootnote) {
                const fn = document.createElement('div');
                fn.style.cssText = `text-align:center; color:${b.color || '#fff'}; margin-top:10px;`;
                fn.textContent = b.text;
                contentRoot.appendChild(fn);
                return;
            }

            if (b.title && b.title.includes('SUMMARY')) {
                const card = document.createElement('div');
                card.className = 'board-card';
                const title = document.createElement('div');
                title.className = 'gmodal-title';
                title.style.textAlign = 'center';
                title.textContent = b.title;
                card.appendChild(title);

                const strip = document.createElement('div');
                strip.style.cssText = 'display:flex; justify-content:center; flex-wrap:wrap; gap:8px; margin-top:8px;';
                (b.entries || []).forEach(e => {
                    const cell = document.createElement('div');
                    cell.style.cssText = 'display:flex; flex-direction:column; align-items:center; background:rgba(0,0,0,0.4); padding:6px 10px; border:1px solid rgba(255,255,255,0.08); flex:1; min-width:80px;';
                    const lbl = document.createElement('span');
                    lbl.className = 'hud-label';
                    lbl.textContent = e.alias;
                    const val = document.createElement('span');
                    val.className = `hud-val ${e.isMe ? 'hud-val-emerald' : ''}`;
                    val.textContent = e.displayValue;
                    cell.append(lbl, val);
                    strip.appendChild(cell);
                });
                card.appendChild(strip);
                summaryRoot.appendChild(card);
                return;
            }

            let myRankScore = 999;
            (b.entries || []).forEach(e => {
                if (e.isMe) {
                    if (e.isNewPb) myRankScore = 0;
                    else {
                        const parsed = parseInt(String(e.rankLabel).replace('#', ''), 10);
                        if (!isNaN(parsed)) myRankScore = parsed;
                    }
                }
            });
            if (myRankScore < bestScore) {
                bestScore = myRankScore;
                flatteringIndex = boardIndex;
            }

            const tabIdx = boardIndex;
            const tabBtn = document.createElement('button');
            tabBtn.type = 'button';
            tabBtn.className = `board-tab ${tabIdx === 0 ? 'active' : ''} ${(shouldHighlightTop10Tabs && top10TabIndices.includes(tabIdx)) ? 'top10-highlight' : ''}`;
            tabBtn.textContent = b.title;
            tabBtn.onclick = () => this.switchBoardTab(tabIdx);
            tabsRoot.appendChild(tabBtn);

            const pane = document.createElement('div');
            pane.className = `board-pane ${tabIdx === 0 ? 'active' : ''}`;
            const card = document.createElement('div');
            card.className = 'board-card';

            if (b.description) {
                const desc = document.createElement('div');
                desc.className = 'hud-label';
                desc.style.cssText = 'text-align:center; color:var(--col-cyan); margin-bottom:8px;';
                desc.textContent = b.description;
                card.appendChild(desc);
            }

            const table = document.createElement('table');
            table.className = 'board-table';
            table.innerHTML = `<thead><tr><th>RANK</th><th>PILOT</th><th style="text-align:right">RECORD</th></tr></thead>`;
            const tbody = document.createElement('tbody');

            (b.entries || []).forEach(e => {
                const tr = document.createElement('tr');
                if (e.isMe) tr.classList.add('row-me');
                if (e.isCurrentRun) tr.classList.add('row-current');

                const tdRank = document.createElement('td');
                tdRank.textContent = e.rankLabel;

                const tdPilot = document.createElement('td');
                tdPilot.textContent = e.alias;
                if (e.ageStr) {
                    const ageSpan = document.createElement('span');
                    ageSpan.className = 'age-badge';
                    ageSpan.textContent = `(${e.ageStr})`;
                    tdPilot.appendChild(ageSpan);
                }
                if (e.isNewPb) {
                    const pbSpan = document.createElement('span');
                    pbSpan.className = 'hud-val-gold';
                    pbSpan.style.marginLeft = '6px';
                    pbSpan.textContent = '[NEW PB!]';
                    tdPilot.appendChild(pbSpan);
                }
                if (e.replayId) {
                    const repBtn = document.createElement('button');
                    repBtn.type = 'button';
                    repBtn.className = 'gbtn gbtn-crimson';
                    repBtn.style.marginLeft = '8px';
                    repBtn.textContent = 'REPLAY';
                    repBtn.onclick = () => this.onWatchReplay(e.replayId);
                    tdPilot.appendChild(repBtn);
                }

                const tdVal = document.createElement('td');
                tdVal.style.textAlign = 'right';
                tdVal.textContent = e.displayValue;

                tr.append(tdRank, tdPilot, tdVal);
                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            card.appendChild(table);
            pane.appendChild(card);
            contentRoot.appendChild(pane);
            boardIndex++;
        });

        if (!isHud) {
            const btnSpec = document.createElement('button');
            btnSpec.type = 'button';
            btnSpec.className = 'gbtn gbtn-lg';
            btnSpec.style.flex = '1';
            btnSpec.textContent = 'SPECTATE';
            btnSpec.onclick = () => { modal.style.display = 'none'; };

            const btnAct = document.createElement('button');
            btnAct.type = 'button';
            btnAct.className = 'gbtn gbtn-emerald gbtn-lg';
            btnAct.style.flex = '1';
            const isRoundMode = currentCategory === 'dogfight' || currentCategory === 'race';
            btnAct.textContent = isRoundMode ? 'PLAY AGAIN' : 'NEXT CAVERN';
            btnAct.onclick = () => {
                if (isRoundMode) this.onRetryLevel();
                else this.onNextLevel();
            };
            footerRoot.append(btnSpec, btnAct);
        }

        if (boardIndex > 0) this.switchBoardTab(flatteringIndex);
        if (!isHud && gotRankOne && onRankOne) onRankOne();
        modal.style.display = 'flex';
    }

    switchBoardTab(index) {
        const tabs = document.querySelectorAll('#board-tabs-container .board-tab');
        const panes = document.querySelectorAll('#leaderboard-content .board-pane');
        tabs.forEach((t, i) => t.classList.toggle('active', i === index));
        panes.forEach((p, i) => p.classList.toggle('active', i === index));
    }

    renderRoomList(list, currentJoinCode) {
        const container = document.getElementById('active-rooms-list');
        if (!container) return;
        container.textContent = '';

        if (!Array.isArray(list) || list.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'hud-label';
            empty.style.textAlign = 'center';
            empty.textContent = 'NO ACTIVE CAVERNS DETECTED';
            container.appendChild(empty);
            return;
        }

        for (const r of list) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.45); padding:6px 10px; border:1px solid rgba(0,242,254,0.2);';
            const info = document.createElement('span');
            info.className = 'hud-val';
            const pilotsStr = (r.pilots && r.pilots.length > 0) ? r.pilots.join(', ') : 'EMPTY';
            info.textContent = `[${r.mode} #${r.joinCode}] ${r.levelName} (${pilotsStr}${r.botCount ? ` +${r.botCount}AI` : ''})`;
            row.appendChild(info);

            if (r.joinCode === currentJoinCode) {
                const badge = document.createElement('span');
                badge.className = 'hud-label';
                badge.style.color = 'var(--col-cyan)';
                badge.textContent = 'ACTIVE';
                row.appendChild(badge);
            } else {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'gbtn';
                btn.textContent = 'JOIN';
                btn.onclick = () => this.onSwitchSession('MP', r.joinCode);
                row.appendChild(btn);
            }
            container.appendChild(row);
        }
    }
}