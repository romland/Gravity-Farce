export class DialogManager {
    constructor(socket, onWatchReplay, onNextLevel, onRetryLevel, onSwitchSession) {
        this.socket = socket;
        this.onWatchReplay = onWatchReplay;
        this.onNextLevel = onNextLevel;
        this.onRetryLevel = onRetryLevel;
        this.onSwitchSession = onSwitchSession;

        this.modals = ['leaderboard-modal', 'room-modal', 'gameover-modal', 'controls-modal', 'fullscreen-modal'];
        this.hintTimer = null;
        this.lastBoards = null;
        this.lastIsHud = false;
        this.lastCategory = 'mission';
        this.lastLevelName = 'CAVERN 00';
        this.bindGlobalKeyboard();
    }

    getFollowedBoards() {
        try {
            const raw = localStorage.getItem('gf_followed_boards');
            if (raw) return new Set(JSON.parse(raw));
        } catch (e) {}
        return new Set(['BLITZ', 'PACIFIST', '5-LIVES STREAK', 'CAMPAIGN SCORE', 'TOP SP RACE TIMES', 'SP BOT ELIMINATION']);
    }

    toggleFollowBoard(title) {
        const set = this.getFollowedBoards();
        if (set.has(title)) set.delete(title);
        else set.add(title);
        localStorage.setItem('gf_followed_boards', JSON.stringify(Array.from(set)));
    }

    promptFullscreenOnce() {
        if (document.fullscreenElement) return;
        const suppressUntil = parseInt(localStorage.getItem('gf_fs_prompt_until') || '0', 10);
        if (Date.now() < suppressUntil) return;
        const modal = document.getElementById('fullscreen-modal');
        if (modal) modal.style.display = 'flex';
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

    bindGlobalKeyboard() {
        window.addEventListener('keydown', (e) => {
            const openModalId = this.modals.find(id => {
                const el = document.getElementById(id);
                return el && el.style.display && el.style.display !== 'none';
            });
            if (!openModalId) return;

            if (openModalId === 'leaderboard-modal') {
                const tabs = Array.from(document.querySelectorAll('#board-tabs-container .board-tab'));
                if (tabs.length > 0) {
                    const activeIdx = tabs.findIndex(t => t.classList.contains('active'));
                    if (e.key >= '1' && e.key <= '9') {
                        const targetIdx = parseInt(e.key, 10) - 1;
                        if (targetIdx >= 0 && targetIdx < tabs.length) {
                            e.preventDefault();
                            this.switchBoardTab(targetIdx);
                            return;
                        }
                    }
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        let nextIdx = activeIdx + (e.key === 'ArrowRight' ? 1 : -1);
                        if (nextIdx < 0) nextIdx = tabs.length - 1;
                        if (nextIdx >= tabs.length) nextIdx = 0;
                        this.switchBoardTab(nextIdx);
                        return;
                    }
                }
            }

            const modalEl = document.getElementById(openModalId);
            if (modalEl) {
                const focusables = Array.from(modalEl.querySelectorAll('button, input, [tabindex="0"]'))
                    .filter(el => el.offsetParent !== null);
                if (focusables.length > 0) {
                    let currentIdx = focusables.indexOf(document.activeElement);
                    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        currentIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % focusables.length;
                        focusables[currentIdx].focus();
                        return;
                    }
                    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        currentIdx = currentIdx === -1 ? focusables.length - 1 : (currentIdx - 1 + focusables.length) % focusables.length;
                        focusables[currentIdx].focus();
                        return;
                    }
                }

                if (e.key === 'Enter') {
                    if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
                        return;
                    }
                    e.preventDefault();
                    const primaryBtn = modalEl.querySelector('.gbtn-emerald, .gbtn-amber, button.gbtn') || modalEl.querySelector('button');
                    if (primaryBtn) {
                        primaryBtn.click();
                    }
                    return;
                }
            }
        });
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

    renderLeaderboard(boards, isHud, currentCategory, onRankOne, levelName = 'CAVERN 00') {
        const modal = document.getElementById('leaderboard-modal');
        if (!modal || !Array.isArray(boards)) return;

        this.lastBoards = boards;
        this.lastIsHud = isHud;
        this.lastCategory = currentCategory || 'mission';
        this.lastLevelName = levelName || 'CAVERN 00';

        const titleEl = document.getElementById('leaderboard-modal-title');
        if (titleEl) {
            const discLabel = (this.lastCategory || 'mission').toUpperCase();
            titleEl.textContent = `ZARKOS LEADERBOARDS: ${(this.lastLevelName || 'CAVERN').toUpperCase()} | ${discLabel}`;
        }

        const summaryRoot = document.getElementById('run-summary-container');
        const catsRoot = document.getElementById('board-cats-container');
        const tabsRoot = document.getElementById('board-tabs-container');
        const contentRoot = document.getElementById('leaderboard-content');
        const footerRoot = document.getElementById('modal-footer');

        summaryRoot.textContent = '';
        if (catsRoot) catsRoot.textContent = '';
        tabsRoot.textContent = '';
        contentRoot.textContent = '';
        footerRoot.textContent = '';

        const followedSet = this.getFollowedBoards();
        const followOnly = localStorage.getItem('gf_follow_filter_active') === '1';
        const savedCatKey = `gf_last_board_cat_${this.lastCategory}`;
        const savedTabKey = `gf_last_board_tab_${this.lastCategory}`;

        let gotRankOne = false;

        const scoredBoards = new Set();
        const hasCategories = boards.some(b => b.category);

        boards.forEach((b) => {
            if (b.isFootnote || (b.title && b.title.includes('SUMMARY'))) return;
            (b.entries || []).forEach(e => {
                if (e.isMe && (e.isCurrentRun || !isHud)) {
                    const parsed = e.rank ?? parseInt(String(e.rankLabel).replace('#', ''), 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
                        if (e.isCurrentRun || e.isNewPb) scoredBoards.add(b.title);
                        if (parsed === 1 && e.isCurrentRun) gotRankOne = true;
                    }
                }
            });
        });

        let activeGroup = localStorage.getItem(savedCatKey) || 'cavern';
        if (!['cavern', 'arcade', 'campaign'].includes(activeGroup)) activeGroup = 'cavern';

        if (catsRoot && hasCategories) {
            catsRoot.style.display = 'flex';
            const leftWrap = document.createElement('div');
            leftWrap.className = 'board-cats-left';
            const groups = [
                { id: 'cavern', label: 'PER CAVERN' },
                { id: 'arcade', label: 'ARCADE (5 LIVES)' },
                { id: 'campaign', label: 'CAMPAIGN' }
            ];
            for (const g of groups) {
                const cBtn = document.createElement('button');
                cBtn.type = 'button';
                cBtn.className = `board-cat-btn ${(!followOnly && activeGroup === g.id) ? 'active' : ''}`;
                cBtn.textContent = g.label;
                cBtn.onclick = () => {
                    localStorage.setItem('gf_follow_filter_active', '0');
                    localStorage.setItem(savedCatKey, g.id);
                    this.renderLeaderboard(this.lastBoards, this.lastIsHud, this.lastCategory, null, this.lastLevelName);
                };
                leftWrap.appendChild(cBtn);
            }

            const fBtn = document.createElement('button');
            fBtn.type = 'button';
            fBtn.className = `board-cat-btn follow-filter ${followOnly ? 'active' : ''}`;
            fBtn.textContent = `★ FOLLOWED (${followedSet.size})`;
            fBtn.onclick = () => {
                localStorage.setItem('gf_follow_filter_active', followOnly ? '0' : '1');
                this.renderLeaderboard(this.lastBoards, this.lastIsHud, this.lastCategory, null, this.lastLevelName);
            };
            catsRoot.append(leftWrap, fBtn);
        } else if (catsRoot) {
            catsRoot.style.display = 'none';
        }

        let boardIndex = 0;
        let targetTabIndex = 0;
        const rememberedTabTitle = localStorage.getItem(savedTabKey);
        
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

            // Filter boards by category or ★ Followed (always include boards where player just scored!)
            if (hasCategories) {
                if (followOnly) {
                    if (!followedSet.has(b.title) && !scoredBoards.has(b.title)) return;
                } else if (b.category && b.category !== activeGroup) {
                    return;
                }
            }

            const tabIdx = boardIndex;
            if (rememberedTabTitle && b.title === rememberedTabTitle) {
                targetTabIndex = tabIdx;
            }

            const tabBtn = document.createElement('button');
            tabBtn.type = 'button';
            tabBtn.dataset.boardTitle = b.title;
            tabBtn.className = `board-tab ${tabIdx === 0 ? 'active' : ''} ${scoredBoards.has(b.title) ? 'top10-highlight' : ''}`;

            const starSpan = document.createElement('span');
            const isStarred = followedSet.has(b.title);
            starSpan.className = `board-tab-star ${isStarred ? 'starred' : ''}`;
            starSpan.textContent = isStarred ? '★' : '☆';
            starSpan.title = 'Follow / Pin Leaderboard';
            starSpan.onclick = (ev) => {
                ev.stopPropagation();
                this.toggleFollowBoard(b.title);
                this.renderLeaderboard(this.lastBoards, this.lastIsHud, this.lastCategory, null, this.lastLevelName);
            };

            const labelSpan = document.createElement('span');
            labelSpan.textContent = b.title;
            tabBtn.append(starSpan, labelSpan);
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
                    repBtn.style.cssText = 'margin-left:8px; padding:2px 6px; font-size:var(--fs-xs); height:22px; line-height:1; vertical-align:middle;';
                    repBtn.style.cssText = 'margin-left:8px; padding:0 5px; font-size:10px; height:18px; line-height:16px; vertical-align:baseline;';
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

        if (boardIndex > 0) this.switchBoardTab(targetTabIndex);
        if (!isHud && gotRankOne && onRankOne) onRankOne();
        modal.style.display = 'flex';
    }

    switchBoardTab(index) {
        const tabs = document.querySelectorAll('#board-tabs-container .board-tab');
        const panes = document.querySelectorAll('#leaderboard-content .board-pane');
        tabs.forEach((t, i) => t.classList.toggle('active', i === index));
        panes.forEach((p, i) => p.classList.toggle('active', i === index));
        const activeTab = tabs[index];
        if (activeTab && activeTab.dataset.boardTitle) {
            localStorage.setItem(`gf_last_board_tab_${this.lastCategory}`, activeTab.dataset.boardTitle);
        }
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