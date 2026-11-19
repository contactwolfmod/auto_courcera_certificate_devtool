(async function autoCompleteCourseraFullMaster() {
    const API_KEY = "YOUR_GEMINI_API_KEY_HERE";
    const LEGAL_NAME = "WM";
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const NL = String.fromCharCode(10);

    const MODELS = [
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-2.5-flash-lite"
    ];

    if (window.location.pathname.includes('/my-learning')) {
        const msg = "⚠️ Bạn đang chạy nhầm tab Trang chủ! Hãy chuyển sang tab bài học rồi chạy lại.";
        console.warn(msg);
        alert(msg);
        return;
    }

    // 1. Gọi Gemini API (Tự động xoay vòng model mới & bắt lỗi Quota 429)
    async function askGemini(promptText) {
        const payload = {
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.1 }
        };

        let lastError = "Không nhận được phản hồi từ máy chủ.";

        for (const model of MODELS) {
            const endpoints = API_KEY.startsWith("AIza")
                ? [`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`]
                : [
                    `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${API_KEY}`,
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`
                  ];

            for (const url of endpoints) {
                try {
                    const res = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();

                    if (res.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                        console.log(`🤖 Model phản hồi thành công: ${model}`);
                        return data.candidates[0].content.parts[0].text.trim();
                    }

                    const errMsg = data.error?.message || `HTTP Error ${res.status}`;
                    if (res.status === 429 || /quota|rate limit|exhausted|resource_exhausted/i.test(errMsg)) {
                        throw new Error(`⛔ HẾT QUOTA API (429): ${errMsg}`);
                    }
                    lastError = `[${model}] ${errMsg}`;
                } catch (e) {
                    if (e.message.includes("HẾT QUOTA")) throw e;
                    lastError = e.message;
                }
            }
        }

        throw new Error(`⛔ AI KHÔNG PHẢN HỒI - ĐÃ DỪNG SCRIPT!\nChi tiết: ${lastError}`);
    }

    function safeClick(el) {
        if (!el) return false;
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.click();
        el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
        return true;
    }

    function isVisible(el) {
        if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    async function clickMarkAsCompletedIfPresent(label) {
        const completeBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(
            b => b.textContent.replace(/\s+/g, ' ').trim().toLowerCase().includes('mark as completed') && isVisible(b)
        );
        if (completeBtn) {
            safeClick(completeBtn);
            console.log(`✅ [${label}] Đã bấm 'Mark as completed'`);
            await sleep(2500);
            return true;
        }
        console.log(`ℹ️ [${label}] Đã hoàn thành hoặc không có nút 'Mark as completed'.`);
        return false;
    }

    // 2. Quét khối câu hỏi thực sự trên màn hình
    function scanQuestionGroups() {
        let groups = Array.from(document.querySelectorAll('[role="radiogroup"], [role="group"]')).filter(g => {
            const inputs = g.querySelectorAll('input[type="radio"], input[type="checkbox"]');
            return inputs.length >= 2 && !/understand and agree/i.test(g.innerText);
        });

        if (groups.length === 0) {
            groups = Array.from(document.querySelectorAll('[data-testid^="part-Submission"], .rc-FormPartsQuestion'))
                .filter((el, _, arr) => !arr.some(other => other !== el && other.contains(el)));
        }

        return groups.map((group, idx) => {
            const labels = Array.from(group.querySelectorAll('label')).filter(l => {
                const t = l.innerText.trim();
                return t && !/^i understand$/i.test(t) && !/understand and agree/i.test(t);
            });
            const options = labels.map(l => l.innerText.replace(/\s+/g, ' ').trim());

            const container = group.closest('[data-testid^="part-Submission"], .rc-FormPartsQuestion') || group.parentElement?.parentElement || group.parentElement;
            const rawLines = (container ? container.innerText : '').split(NL).map(s => s.trim()).filter(s =>
                s && !options.includes(s) &&
                !/^(\d+\.?|question\s*\d+|1 point|\d+\s*points?|multiple choice|checkbox|select one|select all that apply|do you understand\??|i understand|try again|incorrect|correct|\d+\s*\/\s*\d+\s*point)$/i.test(s)
            );

            return {
                questionIndex: idx,
                question: rawLines[0] || `Câu ${idx + 1}`,
                options,
                labelElements: labels
            };
        }).filter(q => q.options.length > 0);
    }

    async function waitForQuestionsToLoad(maxSeconds = 20) {
        console.log("⏳ Đang đợi hệ thống tải câu hỏi...");
        for (let i = 0; i < maxSeconds; i++) {
            const questions = scanQuestionGroups();
            if (questions.length > 0) {
                await sleep(1000);
                return scanQuestionGroups();
            }
            await sleep(1000);
        }
        return [];
    }

    function findNextButton() {
        const byAttr = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(el => {
            if (!isVisible(el)) return false;
            const txt = el.textContent.trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const testId = (el.getAttribute('data-testid') || '').toLowerCase();
            return (
                txt.includes('go to next item') ||
                txt === 'next' ||
                aria.includes('next') ||
                testId.includes('next')
            );
        });
        if (byAttr) return byAttr;

        return Array.from(document.querySelectorAll('button, a')).find(el => {
            if (!isVisible(el) || !el.querySelector('svg')) return false;
            const rect = el.getBoundingClientRect();
            return (
                rect.left > window.innerWidth * 0.8 &&
                rect.top > window.innerHeight * 0.75 &&
                rect.width >= 30 && rect.width <= 70
            );
        });
    }

    function expandAllModules() {
        Array.from(document.querySelectorAll('button')).filter(b =>
            /^module\s*\d+/i.test(b.textContent.trim()) && b.getAttribute('aria-expanded') === 'false'
        ).forEach(btn => btn.click());
    }

    function getAllMenuItems() {
        return Array.from(document.querySelectorAll('a')).filter(a => {
            const href = a.getAttribute('href') || '';
            return (
                href.includes('/lecture/') ||
                href.includes('/supplement/') ||
                href.includes('/assignment-submission/') ||
                href.includes('/quiz/') ||
                href.includes('/practice') ||
                href.includes('/ungradedWidget/') ||
                href.includes('/ungradedLti/') ||
                href.includes('/exam/')
            );
        }).filter((v, i, self) => self.findIndex(t => t.href === v.href) === i);
    }

    async function waitForGradingComplete() {
        console.log("⏳ Đang chờ hệ thống chấm điểm...");
        for (let i = 0; i < 35; i++) {
            await sleep(1000);
            const pageText = document.body.innerText;
            const hasGrade = /your grade|highest grade|to pass|passed|try again|retry|keep learning/i.test(pageText);
            const noDialog = !document.querySelector('[role="dialog"]');
            if (noDialog && hasGrade) {
                console.log("✅ Đã chấm điểm xong!");
                await sleep(1500);

                if (window.location.pathname.includes('/attempt')) {
                    const backBtn = Array.from(document.querySelectorAll('button, a, [role="button"]')).find(
                        el => el.textContent.trim().toLowerCase().includes('back') && isVisible(el)
                    );
                    if (backBtn) {
                        safeClick(backBtn);
                        await sleep(3500);
                    }
                }
                return true;
            }
        }
        return false;
    }

    function getSubmitButtons() {
        return Array.from(document.querySelectorAll('button, [role="button"], [data-testid*="submit" i]')).filter(el => {
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            const txt = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
            return (txt === 'submit' || txt === 'yes, submit' || txt === 'submit assignment') && !txt.includes('save');
        });
    }

    console.log("🚀 Khởi động FULL Auto Coursera (Đã cập nhật API Key mới)...");

    if (window.location.pathname.includes('/home/module/')) {
        const firstItem = getAllMenuItems()[0];
        if (firstItem) {
            safeClick(firstItem);
            await sleep(5000);
        }
    }

    while (true) {
        const currentUrl = window.location.href;
        const currentPath = window.location.pathname;

        // 1. VIDEO
        if (currentPath.includes('/lecture/')) {
            let video = document.querySelector('video');
            for (let w = 0; w < 6 && (!video || !video.duration); w++) {
                await sleep(1000);
                video = document.querySelector('video');
            }

            if (video && video.duration) {
                video.muted = true;
                video.currentTime = video.duration - 1;
                await video.play();
                console.log("🎬 [Video] Đã tua đến cuối video.");
                await sleep(4000);
            } else {
                console.log("⚠️ [Video] Không tìm thấy thẻ video.");
            }
        }

        // 2. READING
        else if (currentPath.includes('/supplement/')) {
            await clickMarkAsCompletedIfPresent('Reading');
        }

        // 3. UNGRADED WIDGET / LAB / PLUGIN
        else if (/\/ungraded(Widget|Lti|Plugin)\//i.test(currentPath)) {
            await clickMarkAsCompletedIfPresent('Ungraded Widget/Plugin');
        }

        // 4. PRACTICE ASSIGNMENT & GRADED ASSIGNMENT
        else if (/\/(assignment-submission|quiz|practice|exam|attempt)/i.test(currentPath)) {
            console.log("📝 [Quiz/Practice] Đang kiểm tra bài tập:", currentPath);

            let quizData = await waitForQuestionsToLoad(3);

            if (quizData.length === 0 && !window.location.pathname.includes('/attempt')) {
                const alreadyPassed = /passed/i.test(document.body.innerText) && !/not passed/i.test(document.body.innerText);
                if (alreadyPassed) {
                    console.log("ℹ️ [Quiz/Practice] Bài này đã đạt (Passed) từ trước, bỏ qua.");
                } else {
                    const startKeywords = ['start assignment', 'start practice', 'resume assignment', 'resume', 'try again', 'retry'];
                    let startBtn = null;
                    for (const kw of startKeywords) {
                        startBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(el => {
                            if (el.closest('nav, aside')) return false;
                            const txt = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
                            return (txt === kw || txt.startsWith(kw)) && !txt.includes('help me') && isVisible(el);
                        });
                        if (startBtn) break;
                    }

                    if (startBtn) {
                        console.log(`🚀 Đang bấm nút '${startBtn.textContent.trim()}'...`);
                        safeClick(startBtn);
                        quizData = await waitForQuestionsToLoad(20);
                    } else {
                        console.warn("⚠️ Không tìm thấy nút Start assignment.");
                    }
                }
            }

            if (quizData.length > 0) {
                const promptText = `Bạn là chuyên gia giải đề Cybersecurity của Google. Trả về CHÍNH XÁC mảng JSON 2 chiều chứa index (bắt đầu từ 0) của đáp án đúng cho từng câu (nếu đề yêu cầu "Select two/three answers" hoặc "Select all that apply" thì chọn đủ số lượng đáp án đúng, ví dụ: [[0, 2], [1], [3]]). Chỉ trả về JSON thuần túy, không giải thích, không markdown:${NL}${NL}` +
                    quizData.map(q => `Câu ${q.questionIndex + 1}: ${q.question}${NL}` + q.options.map((opt, idx) => `  [${idx}] ${opt}`).join(NL)).join(NL + NL);

                try {
                    console.log(`🧠 Đang gửi ${quizData.length} câu hỏi cho Gemini AI...`);
                    const rawReply = await askGemini(promptText);
                    const cleanJson = rawReply.replace(/^```json/i, '').replace(/```$/i, '').trim();
                    const answers = JSON.parse(cleanJson);

                    if (!Array.isArray(answers) || answers.length !== quizData.length) {
                        throw new Error(`AI trả về sai định dạng hoặc thiếu câu (${answers?.length}/${quizData.length}).`);
                    }

                    console.log("✅ Đáp án AI chọn:", answers);

                    quizData.forEach((q, qIdx) => {
                        const chosen = answers[qIdx];
                        q.labelElements.forEach((lbl, optIdx) => {
                            const inp = lbl.querySelector('input') || document.getElementById(lbl.getAttribute('for'));
                            const isChecked = inp ? inp.checked : false;
                            const shouldCheck = chosen.includes(optIdx);
                            if (isChecked !== shouldCheck) {
                                lbl.click();
                            }
                        });
                    });

                    await sleep(1000);

                    const honorLabel = Array.from(document.querySelectorAll('label')).find(
                        l => /understand and agree/i.test(l.textContent)
                    );
                    const nameInput = document.querySelector('input[placeholder*="legal name" i], input[type="text"]');

                    if (honorLabel) {
                        const checkbox = honorLabel.querySelector('input[type="checkbox"]') || document.getElementById(honorLabel.getAttribute('for'));
                        if (checkbox && !checkbox.checked) checkbox.click();
                        else if (!checkbox) honorLabel.click();
                        console.log("☑️ Đã tích ô cam kết Honor Code.");
                    } else if (nameInput) {
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                        setter.call(nameInput, LEGAL_NAME);
                        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                        console.log(`✍️ Đã điền Legal name: ${LEGAL_NAME}`);
                    }

                    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
                    await sleep(1200);

                    let submitBtns1 = getSubmitButtons();
                    if (submitBtns1.length === 0) {
                        await sleep(1500);
                        submitBtns1 = getSubmitButtons();
                    }

                    if (submitBtns1.length > 0) {
                        const targetBtn = submitBtns1[submitBtns1.length - 1];
                        safeClick(targetBtn);
                        console.log("⏳ Đã bấm Submit lần 1, kiểm tra hộp thoại xác nhận...");

                        for (let attempt = 0; attempt < 8; attempt++) {
                            await sleep(500);
                            const submitBtns2 = getSubmitButtons();
                            const dialogSubmit = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"]')).find(b => {
                                const txt = b.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
                                return (txt === 'submit' || txt === 'yes, submit') && !b.disabled;
                            });

                            if (dialogSubmit) {
                                safeClick(dialogSubmit);
                                console.log("📨 Đã bấm xác nhận Submit lần 2 trong hộp thoại!");
                                break;
                            } else if (submitBtns2.length >= 2) {
                                safeClick(submitBtns2[submitBtns2.length - 1]);
                                console.log("📨 Đã bấm xác nhận Submit lần 2!");
                                break;
                            }
                        }

                        await waitForGradingComplete();
                    } else {
                        console.warn("⚠️ Không tìm thấy nút Submit khả dụng sau khi tích cam kết, dừng script.");
                        break;
                    }
                } catch (err) {
                    console.error("❌ Lỗi xử lý Quiz/Practice:", err.message);
                    alert(err.message);
                    break;
                }
            } else if (!/passed/i.test(document.body.innerText)) {
                console.warn("⚠️ Quá 20 giây nhưng câu hỏi vẫn chưa tải xong, dừng script để kiểm tra.");
                break;
            }
        }

        // 5. CÁC MỤC KHÁC
        else {
            await clickMarkAsCompletedIfPresent('Other');
        }

        // 6. CHUYỂN SANG BÀI TIẾP THEO
        expandAllModules();
        await sleep(500);
        const menuItems = getAllMenuItems();
        const baseCurrentPath = window.location.pathname.replace(/\/attempt\/?$/, '');
        const currentIndex = menuItems.findIndex(a => a.pathname.includes(baseCurrentPath) || baseCurrentPath.includes(a.pathname));

        if (currentIndex !== -1 && currentIndex + 1 < menuItems.length) {
            const nextItem = menuItems[currentIndex + 1];
            console.log(`➡️ [${currentIndex + 2}/${menuItems.length}] Chuyển sang: ${nextItem.innerText.split(NL)[0]}`);
            safeClick(nextItem);
            await sleep(5000);
        } else {
            const nextBtn = findNextButton();
            if (nextBtn) {
                console.log("➡️ Chuyển sang bài tiếp theo...");
                safeClick(nextBtn);
                await sleep(5000);
            } else {
                console.log("🎉 Đã đi đến cuối khóa học!");
                break;
            }
        }
    }
})();
