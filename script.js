/* =========================================================
   1. 配置與常數
   ========================================================= */
const PALETTE = [
    { id: 'W', hex: 0xFFFFFF, name: 'White' },
    { id: 'Y', hex: 0xFFFF00, name: 'Yellow' }
];

// 4x4 共有 24 個中心塊。定義索引映射 (0-23)
// 面順序: U(0-3), F(4-7), R(8-11), D(12-15), L(16-19), B(20-23)
// 每個面的中心塊排列: 左上, 右上, 左下, 右下 (Row-Major)
const FACE_INDICES = {
    U: [0,1,2,3], F: [4,5,6,7], R: [8,9,10,11],
    D: [12,13,14,15], L: [16,17,18,19], B: [20,21,22,23]
};

// 顏色常數
const C_BLACK = 0x111111; // 未填色狀態
const C_CORE = 0x000000;  // 核心顏色

// Three.js 變數
let scene, camera, renderer, cubeGroup;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let currentPaletteIdx = 0; // 預設白色
let isAnimating = false;

// 狀態陣列: 儲存 24 個中心塊的顏色 ID (0~5)，-1 表示未填色
let cubeState = new Array(24).fill(-1);

/* =========================================================
   2. 初始化與 3D 建置 (透明半透視風格)
   ========================================================= */
init();
animate();

function init() {
    // [修改] ID 改為 canvas-wrapper 以配合新 CSS
    const container = document.getElementById('canvas-wrapper');
    
    scene = new THREE.Scene();
    scene.background = null; 

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // [修改] 修正 renderer 的 style 確保絕對定位不跑版
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '0'; // 確保在 UI 之下
    
    container.appendChild(renderer.domElement);

    const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 8);
    scene.add(dirLight);
    
    const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
    backLight.position.set(-5, -5, -10);
    scene.add(backLight);

    create4x4Cube();
    initPalette();
    
    // [新增] 呼叫 resize 確保初始大小正確
    window.addEventListener('resize', onResize);
    onResize();

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
}

function create4x4Cube() {
    // 若已有群組則先移除
    if (cubeGroup) scene.remove(cubeGroup);
    cubeGroup = new THREE.Group();

    // 1. 幾何體設定：實心方塊，稍微縮小留出縫隙
    const geometry = new THREE.BoxGeometry(0.94, 0.94, 0.94);
    
    // 2. 材質設定
    // 核心黑色材質 (用於方塊內部看不到的地方)
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    
    // 未填色的貼紙顏色 (深灰色)
    const EMPTY_COLOR = 0x282828; 

    // 遍歷 4x4x4 座標 (範圍 -1.5 到 1.5)
    for(let x = -1.5; x <= 1.5; x += 1) {
        for(let y = -1.5; y <= 1.5; y += 1) {
            for(let z = -1.5; z <= 1.5; z += 1) {
                
                // 建立該方塊的資料物件
                let meshData = { x, y, z, isCenter: false, index: -1 };
                
                // 判斷是否為中心塊
                // 順序: R(0), L(1), U(2), D(3), F(4), B(5)
                const mats = [];

                // 輔助函式：取得該面的材質
                const getMatForFace = (faceName) => {
                    // 檢查這面是否暴露在外
                    let isExposed = false;
                    if (faceName === 'R' && x === 1.5) isExposed = true;
                    if (faceName === 'L' && x === -1.5) isExposed = true;
                    if (faceName === 'U' && y === 1.5) isExposed = true;
                    if (faceName === 'D' && y === -1.5) isExposed = true;
                    if (faceName === 'F' && z === 1.5) isExposed = true;
                    if (faceName === 'B' && z === -1.5) isExposed = true;

                    if (!isExposed) return coreMat;

                    // 判斷是否為中心塊區域
                    let isCenterFace = false;
                    if (faceName === 'R' || faceName === 'L') isCenterFace = (Math.abs(y) === 0.5 && Math.abs(z) === 0.5);
                    if (faceName === 'U' || faceName === 'D') isCenterFace = (Math.abs(x) === 0.5 && Math.abs(z) === 0.5);
                    if (faceName === 'F' || faceName === 'B') isCenterFace = (Math.abs(x) === 0.5 && Math.abs(y) === 0.5);

                    let colorHex = EMPTY_COLOR;
                    
                    if (isCenterFace) {
                        meshData.isCenter = true;
                        // 計算 Index (與原始邏輯相同)
                        const row = (v) => (v === -0.5 ? 0 : 1); 
                        const rowInv = (v) => (v === 0.5 ? 0 : 1);
                        let idx = -1;

                        if (faceName === 'U') idx = 0 + (z===-0.5?0:2) + (x===-0.5?0:1);
                        else if (faceName === 'F') idx = 4 + rowInv(y)*2 + (x===-0.5?0:1);
                        else if (faceName === 'R') idx = 8 + rowInv(y)*2 + (z===0.5?0:1);
                        else if (faceName === 'D') idx = 12 + (z===0.5?0:2) + (x===-0.5?0:1);
                        else if (faceName === 'L') idx = 16 + rowInv(y)*2 + (z===-0.5?0:1);
                        else if (faceName === 'B') idx = 20 + rowInv(y)*2 + (x===0.5?0:1);
                        
                        meshData.index = idx;

                        // 如果狀態陣列已有顏色，則使用該顏色
                        if (idx !== -1 && cubeState[idx] !== -1) {
                            colorHex = PALETTE[cubeState[idx]].hex;
                        }
                    }

                    return new THREE.MeshStandardMaterial({
                        color: colorHex,
                        roughness: 0.6,
                        metalness: 0.1
                    });
                };

                mats.push(getMatForFace('R'));
                mats.push(getMatForFace('L'));
                mats.push(getMatForFace('U'));
                mats.push(getMatForFace('D'));
                mats.push(getMatForFace('F'));
                mats.push(getMatForFace('B'));

                const mesh = new THREE.Mesh(geometry, mats);
                mesh.position.set(x, y, z);
                mesh.userData = meshData;
                cubeGroup.add(mesh);
            }
        }
    }

    // --- 新增：建立方位標籤 (U 與 F) ---
    // 建立透明背景文字 Canvas Texture 的輔助函式
    const createLabelMesh = (text) => {
        const canvas = document.createElement('canvas');
        canvas.width = 128; 
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // 畫一個半透明圓底，增加對比度
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.arc(64, 64, 50, 0, Math.PI * 2);
        ctx.fill();

        // 畫文字
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 80px "Chakra Petch", Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 64);

        const texture = new THREE.CanvasTexture(canvas);
        const labelGeo = new THREE.PlaneGeometry(1, 1);
        const labelMat = new THREE.MeshBasicMaterial({ 
            map: texture, 
            transparent: true, 
            side: THREE.DoubleSide, // 雙面顯示，避免轉過去後看不到
            // [修正] 移除 depthTest: false，讓它參與深度計算，這樣轉到背面時就會被方塊遮擋
        });
        const mesh = new THREE.Mesh(labelGeo, labelMat);
        
        // [修正] 移除 renderOrder，恢復標準渲染順序
        // mesh.renderOrder = 999; 

        // [修正] 禁用此 Mesh 的射線檢測，讓點擊可以直接穿透標籤，選取到後方的方塊
        mesh.raycast = function () {}; 

        return mesh;
    };

    // 1. 頂面 (U) 標籤
    const labelU = createLabelMesh('U');
    // 位置：Y軸最高處 (1.5) 再往上一點 (2.1)，置中
    labelU.position.set(0, 2.1, 0); 
    // 旋轉：平躺 (繞X軸 -90度)
    labelU.rotation.x = -Math.PI / 2;
    // 稍微旋轉文字方向使其面對初始相機 (可選)
    labelU.rotation.z = 0; 
    cubeGroup.add(labelU);

    // 2. 前面 (F) 標籤
    const labelF = createLabelMesh('F');
    // 位置：Z軸最前處 (1.5) 再往外一點 (2.1)，置中
    labelF.position.set(0, 0, 2.1);
    // 旋轉：無需旋轉，預設面向 Z 軸正向
    cubeGroup.add(labelF);
    
    // 調整群組初始角度 (配合正前方的相機，設定一個美觀的 ISO 視角)
    cubeGroup.rotation.x = 0.35; 
    cubeGroup.rotation.y = -0.6;
    
    scene.add(cubeGroup);
}


function initPalette() {
    const p = document.getElementById('palette');
    p.innerHTML = ''; // 清空內容防止重複
    
    PALETTE.forEach((c, i) => {
        const div = document.createElement('div');
        div.className = 'color-swatch';
        div.style.backgroundColor = '#' + c.hex.toString(16).padStart(6, '0');
        
        // 第一個顏色預設選中
        if(i === 0) div.classList.add('selected');
        
        div.onclick = () => {
            // 移除其他選中狀態
            document.querySelectorAll('.color-swatch').forEach(d => d.classList.remove('selected'));
            div.classList.add('selected');
            currentPaletteIdx = i;
        };
        
        p.appendChild(div);
    });
}

/* =========================================================
   3. 互動與填色
   ========================================================= */
function onPointerDown(event) {
    if(isAnimating) return;
    event.preventDefault();
    
    // 取得畫布邊界，確保在不同佈局下座標正確
    const rect = renderer.domElement.getBoundingClientRect();
    const clientX = event.clientX || (event.touches ? event.touches[0].clientX : 0);
    const clientY = event.clientY || (event.touches ? event.touches[0].clientY : 0);

    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(cubeGroup.children);

    if (intersects.length > 0) {
        const hit = intersects[0];
        // 取得被點擊面的材質索引 (0-5)
        const matIdx = hit.face.materialIndex;
        // 取得該面的材質物件
        const mat = hit.object.material[matIdx];
        
        // 從材質顏色判斷是否為「核心黑色」，如果是則忽略點擊 (只允許點擊外層貼紙)
        if (mat.color.getHex() === 0x000000) return;

        // 檢查是否為有效的中心塊 (透過我們在 create4x4Cube 設定的 userData)
        if (hit.object.userData.isCenter) {
            const hex = PALETTE[currentPaletteIdx].hex;
            
            // 直接設定顏色
            mat.color.setHex(hex);
            
            // 更新內部狀態陣列
            const idx = hit.object.userData.index;
            if(idx !== -1) {
                cubeState[idx] = currentPaletteIdx;
            }
            
            // 清除之前的解答狀態
            document.getElementById('solution-text').innerText = "READY";
            document.getElementById('solution-text').style.color = "#FFD60A";
            document.getElementById('solution-stats').innerText = "";
        }
    }
}

function rotateView(dx, dy) {
    if(isAnimating) return;
    isAnimating = true;

    // 旋轉整個 Group
    const startRot = cubeGroup.rotation.clone();
    // 依世界座標軸旋轉
    const xAxis = new THREE.Vector3(1,0,0);
    const yAxis = new THREE.Vector3(0,1,0);
    
    // 計算目標 Quaternion
    const qx = new THREE.Quaternion();
    qx.setFromAxisAngle(xAxis, dy * Math.PI/2);
    const qy = new THREE.Quaternion();
    qy.setFromAxisAngle(yAxis, dx * Math.PI/2);
    
    const startQ = cubeGroup.quaternion.clone();
    const targetQ = qy.multiply(startQ).multiply(qx);

    // Tween 動畫
    const o = { t: 0 };
    new TWEEN.Tween(o)
        .to({ t: 1 }, 300)
        .easing(TWEEN.Easing.Quadratic.Out)
        .onUpdate(() => {
            cubeGroup.quaternion.slerpQuaternions(startQ, targetQ, o.t);
        })
        .onComplete(() => {
            isAnimating = false;
        })
        .start();
}

function resetCube() {
    // 1. 重置狀態陣列
    cubeState.fill(-1);
    
    // 2. 定義未填色時的顏色 (需與 create4x4Cube 中的 EMPTY_COLOR 一致)
    const EMPTY_COLOR = 0x282828; 

    // 3. 遍歷所有方塊進行重置
    cubeGroup.children.forEach(mesh => {
        // 只有中心塊需要重置顏色
        if (mesh.userData.isCenter) {
            // 找出該 mesh 身上所有不是黑色的材質 (即外觀貼紙)
            mesh.material.forEach(m => {
                // 只要不是核心黑色(0x000000)，就重置為灰色
                if(m.color.getHex() !== 0x000000) {
                    m.color.setHex(EMPTY_COLOR);
                }
            });
        }
    });

    // 4. 重置 UI 文字
    document.getElementById('solution-text').innerText = "READY";
    document.getElementById('solution-text').style.color = "#FFD60A";
    
    // [新增] 清空反向公式
    const invText = document.getElementById('inverse-solution-text');
    if(invText) invText.innerText = "";
    
    document.getElementById('solution-stats').innerText = "";
}

function onResize() {
    // [修改] ID 改為 canvas-wrapper
    const container = document.getElementById('canvas-wrapper');
    if (!container) return; // 安全檢查
    
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate(time) {
    requestAnimationFrame(animate);
    TWEEN.update(time);
    renderer.render(scene, camera);
}

/* =========================================================
   4. Solver 核心邏輯 (IDA* + 位元狀態壓縮 + 完整步數)
   ========================================================= */

// 定義所有可用的移動 (包含寬層與單層)
// 順序安排是為了優化剪枝邏輯：每 12 個移動屬於同一個軸 (Axis)
// Axis 0 (X軸): Rw, Lw, R, L
// Axis 1 (Y軸): Uw, Dw, U, D
// Axis 2 (Z軸): Fw, Bw, F, B
const MOVE_NAMES = [
    // --- Axis 0: X-Axis Moves ---
    "Rw", "Rw2", "Rw'", "Lw", "Lw2", "Lw'", 
    "R",  "R2",  "R'",  "L",  "L2",  "L'",
    
    // --- Axis 1: Y-Axis Moves ---
    "Uw", "Uw2", "Uw'", "Dw", "Dw2", "Dw'", 
    "U",  "U2",  "U'",  "D",  "D2",  "D'",
    
    // --- Axis 2: Z-Axis Moves ---
    "Fw", "Fw2", "Fw'", "Bw", "Bw2", "Bw'", 
    "F",  "F2",  "F'",  "B",  "B2",  "B'",

    // --- Rotations (新增 x, y, z，算一步，無180度) ---
    "x", "x'", "y", "y'", "z", "z'"
];

let PERM_TABLE = [];

// 工具：生成 Permutation Table
// 24個位置，根據 4x4 轉動規則
function createPermutation(baseMove) {
    // 初始狀態 0..23
    let s = Array.from({length:24}, (_,i)=>i);

    const swap4 = (arr, a, b, c, d) => {
        let tmp = arr[d]; arr[d]=arr[c]; arr[c]=arr[b]; arr[b]=arr[a]; arr[a]=tmp;
    };

    // --- Face Rotations (Outer Layer) ---
    // 這些移動只旋轉面上的中心塊，不影響其他面
    // 注意：所有 Wide Move (如 Rw) 根據 WCA 定義都包含 Face Rotation
    
    // R Face (8-11): 8->9->11->10
    if (baseMove === 'Rw' || baseMove === 'R') {
        swap4(s, 8, 9, 11, 10);
    }
    // L Face (16-19): 16->17->19->18
    if (baseMove === 'Lw' || baseMove === 'L') {
        swap4(s, 16, 17, 19, 18);
    }
    // U Face (0-3): 0->1->3->2
    if (baseMove === 'Uw' || baseMove === 'U') {
        swap4(s, 0, 1, 3, 2);
    }
    // D Face (12-15): 12->13->15->14
    if (baseMove === 'Dw' || baseMove === 'D') {
        swap4(s, 12, 13, 15, 14);
    }
    // F Face (4-7): 4->5->7->6
    if (baseMove === 'Fw' || baseMove === 'F') {
        swap4(s, 4, 5, 7, 6);
    }
    // B Face (20-23): 20->21->23->22
    if (baseMove === 'Bw' || baseMove === 'B') {
        swap4(s, 20, 21, 23, 22);
    }

    // --- Slice Moves (Inner Layer) ---
    // 只有 Wide Moves (Rw, Lw...) 會觸發切片移動
    
    if (baseMove === 'Rw') {
        swap4(s, 5, 1, 22, 13); // FTR -> UTR -> BBL -> DTR
        swap4(s, 7, 3, 20, 15); // FBR -> UBR -> BTL -> DBR
    }
    if (baseMove === 'Lw') {
        swap4(s, 0, 4, 12, 23); // UTL -> FTL -> DTL -> BBR
        swap4(s, 2, 6, 14, 21); // UBL -> FBL -> DBL -> BTR
    }
    if (baseMove === 'Uw') {
        swap4(s, 4, 16, 20, 8); // FTL -> LTL -> BTL -> RTL
        swap4(s, 5, 17, 21, 9); // FTR -> LTR -> BTR -> RTR
    }
    if (baseMove === 'Dw') {
        swap4(s, 6, 10, 22, 18); // FBL -> RBL -> BBL -> LBL
        swap4(s, 7, 11, 23, 19); // FBR -> RBR -> BBR -> LBR
    }
    if (baseMove === 'Fw') {
        swap4(s, 2, 8, 13, 19); // UBL -> RTL -> DTR -> LBR
        swap4(s, 3, 10, 12, 17); // UBR -> RBL -> DTL -> LTR
    }
    if (baseMove === 'Bw') {
        swap4(s, 1, 16, 14, 11); // UTR -> LTL -> DBL -> RBR
        swap4(s, 0, 18, 15, 9);  // UTL -> LBL -> DBR -> RTR
    }

    return s;
}

function initSolver() {
    PERM_TABLE = [];
    
    // 建立 0-35 的標準層轉動
    const bases = [
        'Rw', 'Lw', 'R', 'L',
        'Uw', 'Dw', 'U', 'D',
        'Fw', 'Bw', 'F', 'B'
    ];
    
    bases.forEach(base => {
        const p1 = createPermutation(base); // 90度
        const p2 = p1.map(x => p1[x]);      // 180度
        const p3 = p2.map(x => p1[x]);      // 270度 (')
        PERM_TABLE.push(p1, p2, p3);
    });

    // 建立 36-41 的整體旋轉 (x, y, z)
    // 邏輯組合：x = Rw + Lw', y = Uw + Dw', z = Fw + Bw'
    const combine = (idx1, idx2) => {
        const p1 = PERM_TABLE[idx1];
        const p2 = PERM_TABLE[idx2];
        const res = new Array(24);
        for(let i=0; i<24; i++) res[i] = p1[p2[i]];
        return res;
    };

    const getIdx = (name) => MOVE_NAMES.indexOf(name);

    // x (Rw Lw')
    PERM_TABLE.push(combine(getIdx("Rw"), getIdx("Lw'"))); // x (36)
    PERM_TABLE.push(combine(getIdx("Rw'"), getIdx("Lw"))); // x' (37)
    
    // y (Uw Dw')
    PERM_TABLE.push(combine(getIdx("Uw"), getIdx("Dw'"))); // y (38)
    PERM_TABLE.push(combine(getIdx("Uw'"), getIdx("Dw"))); // y' (39)

    // z (Fw Bw')
    PERM_TABLE.push(combine(getIdx("Fw"), getIdx("Bw'"))); // z (40)
    PERM_TABLE.push(combine(getIdx("Fw'"), getIdx("Bw"))); // z' (41)
}
// 立即初始化
initSolver();

// 應用 Permutation 到狀態
function applyMove(state, moveIdx) {
    const p = PERM_TABLE[moveIdx];
    const newState = new Int8Array(24);
    for(let i=0; i<24; i++) {
        newState[i] = state[p[i]];
    }
    return newState;
}

// 求解主函數
// 請將此函式完整覆蓋原本 script.js 中的 solveCenters 函式

/* =========================================================
   極速 Solver 模組 (PDB + IDA* + Bit Manipulation)
   ========================================================= */

// 全域 PDB 緩存 (只生成一次，16MB)
let PDB_TABLE = null; 
// 6個面的映射變換表 (用來將任意面轉到 U 面查表)
let FACE_TRANSFORMS = null; 

/* =========================================================
   Solver 核心邏輯 (IDA* + 位元狀態壓縮 + TwistyPlayer 整合)
   ========================================================= */
function solveCenters() {
    // 0. 預先取得 UI 元素以便顯示錯誤訊息
    const output = document.getElementById('solution-text');
    const outputInv = document.getElementById('inverse-solution-text');
    const stats = document.getElementById('solution-stats');
    const player = document.getElementById('solution-player');

    // 1. 驗證輸入與顏色偵測
    let wId = -1, yId = -1;
    const counts = [0,0,0,0,0,0];
    cubeState.forEach(c => { if(c!==-1) counts[c]++; });
    
    // 檢查是否標準白黃 (各4格)
    if (counts[0] === 4 && counts[1] === 4) {
        wId = 0; yId = 1;
    } else {
        // 檢查是否有任意兩色正好 4 格
        const candidates = [];
        counts.forEach((cnt, colId) => { if (cnt === 4) candidates.push(colId); });
        
        if (candidates.length === 2) {
            wId = candidates[0]; yId = candidates[1];
        } else {
            // --- 修改處：移除 alert，改為顯示在介面上 ---
            output.innerText = "錯誤：顏色數量不對";
            output.style.color = "#FF4444"; // 設定為紅色警告
            
            if(outputInv) outputInv.innerText = ""; // 清空第二行文字
            
            // 在狀態區顯示詳細資訊
            stats.innerText = `請確保兩色各填 4 格\n目前數量: [${counts.join(', ')}]`;
            
            // 清空播放器內容
            if (player) {
                player.alg = "";
                player.experimentalSetupAlg = "";
            }
            return; // 終止函式
            // ----------------------------------------
        }
    }

    // 2. 獲取使用者指定的白色目標面
    const targetSelect = document.getElementById('target-face');
    const targetFaceVal = targetSelect ? targetSelect.value : 'U';
    
    const FACE_MAP = { 'U': 0, 'D': 1, 'F': 2, 'B': 3, 'R': 4, 'L': 5 };
    const OPPOSITE_MAP = { 0: 1, 1: 0, 2: 3, 3: 2, 4: 5, 5: 4 };

    const targetIdx = FACE_MAP[targetFaceVal];
    const oppIdx = OPPOSITE_MAP[targetIdx];

    // 重置顯示狀態
    output.innerText = "SCANNING...";
    if(outputInv) outputInv.innerText = "";
    output.style.color = "#FFD60A";
    stats.innerText = ""; // 清空錯誤訊息或舊數據

    setTimeout(() => {
        // --- 初始化 PDB ---
        if (!PDB_TABLE) initPDB();

        const baseState = new Int8Array(cubeState);
        const startTime = performance.now();

        // ---------------------------------------------------------
        // 內部工具：計算啟發值
        // ---------------------------------------------------------
        const getMask = (s, color) => {
            let mask = 0;
            for(let i=0; i<24; i++) if (s[i] === color) mask |= (1 << i);
            return mask;
        };

        const applyPermToMask = (mask, perm) => {
            let res = 0;
            for(let i=0; i<24; i++) if ((mask >> perm[i]) & 1) res |= (1 << i);
            return res;
        };

        const getH = (s) => {
            const wMask = getMask(s, wId);
            const yMask = getMask(s, yId);
            const wOnU = applyPermToMask(wMask, FACE_TRANSFORMS[targetIdx]);
            const yOnU = applyPermToMask(yMask, FACE_TRANSFORMS[oppIdx]);
            return Math.max(PDB_TABLE[wOnU], PDB_TABLE[yOnU]);
        };

        // ---------------------------------------------------------
        // 定義 24 種起手勢 (保留原始邏輯)
        // ---------------------------------------------------------
        const orientationDefs = [
            { name: "",       moves: [] },
            { name: "y",      moves: ["y"] }, { name: "y2",     moves: ["y", "y"] }, { name: "y'",     moves: ["y'"] },
            { name: "x",      moves: ["x"] }, { name: "x y",    moves: ["x", "y"] }, { name: "x y2",   moves: ["x", "y", "y"] }, { name: "x y'",   moves: ["x", "y'"] },
            { name: "x2",     moves: ["x", "x"] }, { name: "x2 y",   moves: ["x", "x", "y"] }, { name: "x2 y2",  moves: ["x", "x", "y", "y"] }, { name: "x2 y'",  moves: ["x", "x", "y'"] },
            { name: "x'",     moves: ["x'"] }, { name: "x' y",   moves: ["x'", "y"] }, { name: "x' y2",  moves: ["x'", "y", "y"] }, { name: "x' y'",  moves: ["x'", "y'"] },
            { name: "z",      moves: ["z"] }, { name: "z y",    moves: ["z", "y"] }, { name: "z y2",   moves: ["z", "y", "y"] }, { name: "z y'",   moves: ["z", "y'"] },
            { name: "z'",     moves: ["z'"] }, { name: "z' y",   moves: ["z'", "y"] }, { name: "z' y2",  moves: ["z'", "y", "y"] }, { name: "z' y'",  moves: ["z'", "y'"] }
        ];

        // 步驟一：快速篩選 (Pre-scan)
        let bestCandidate = null;
        let minH = Infinity;
        let bestStartMaskState = null;

        for (let orient of orientationDefs) {
            let tempState = new Int8Array(baseState);
            for (let moveName of orient.moves) {
                const idx = MOVE_NAMES.indexOf(moveName);
                if (idx !== -1) {
                    const p = PERM_TABLE[idx];
                    const next = new Int8Array(24);
                    for(let i=0; i<24; i++) next[i] = tempState[p[i]];
                    tempState = next;
                }
            }

            const h = getH(tempState);
            if (h < minH) {
                minH = h;
                bestCandidate = orient;
                bestStartMaskState = tempState;
            } else if (h === minH) {
                if (orient.moves.length < bestCandidate.moves.length) {
                    bestCandidate = orient;
                    bestStartMaskState = tempState;
                }
            }
        }

        // 步驟二：IDA* 求解
        const fastApply = (state, moveIdx) => {
            const p = PERM_TABLE[moveIdx];
            const ns = state.slice();
            for(let i=0; i<24; i++) ns[i] = state[p[i]];
            return ns;
        };

        const isSolved = (s) => {
            const faces = [
                [0,1,2,3], [12,13,14,15], [4,5,6,7],
                [20,21,22,23], [8,9,10,11], [16,17,18,19]
            ];
            for (let i of faces[targetIdx]) if (s[i] !== wId) return false;
            for (let i of faces[oppIdx]) if (s[i] !== yId) return false;
            return true;
        };

        // ---------------------------------------------------------
        // [修改] 建立排序後的移動列表 (Preference Sorting)
        // ---------------------------------------------------------
        let sortedMoves = [];
        for (let i = 0; i < 42; i++) sortedMoves.push(i);
        
        sortedMoves.sort((a, b) => {
            const nameA = MOVE_NAMES[a];
            const nameB = MOVE_NAMES[b];
            
            // 判斷是否為「不受歡迎」的移動
            const isBadA = nameA.includes("Bw") || nameA.includes("Dw");
            const isBadB = nameB.includes("Bw") || nameB.includes("Dw");
            
            if (isBadA && !isBadB) return 1;  // A 是壞的，B 是好的 -> A 排後面 (1)
            if (!isBadA && isBadB) return -1; // A 是好的，B 是壞的 -> A 排前面 (-1)
            return 0; // 兩者性質相同，保持原始順序 (通常是軸順序)
        });

        let path = [];
        let found = false;
        let totalNodes = 0;

        const search = (g, bound, prevState, lastMoveFace) => {
            totalNodes++;
            const h = getH(prevState);
            const f = g + h;
            if (f > bound) return f;
            if (h === 0 && isSolved(prevState)) {
                found = true;
                return f;
            }

            let min = Infinity;
            
            // [修改] 使用排序後的 sortedMoves 進行遍歷
            for (let i = 0; i < 42; i++) {
                const m = sortedMoves[i]; // 取出實際的移動索引

                const currentIsRot = m >= 36;
                const currentFace = currentIsRot ? 9 : Math.floor(m / 3); 
                const currentAxis = currentIsRot ? 9 : Math.floor(currentFace / 4);

                if (lastMoveFace !== -1) {
                    if (currentIsRot && lastMoveFace === 9) continue;
                    if (!currentIsRot && lastMoveFace !== 9) {
                        const lastAxis = Math.floor(lastMoveFace / 4);
                        if (currentAxis === lastAxis && currentFace <= lastMoveFace) continue;
                    }
                }

                const nextState = fastApply(prevState, m);
                path.push(MOVE_NAMES[m]);
                const t = search(g + 1, bound, nextState, currentIsRot ? 9 : currentFace);
                if (found) return t;
                path.pop();
                if (t < min) min = t;
            }
            return min;
        };

        let bound = getH(bestStartMaskState);
        while (!found && bound <= 12) {
            const t = search(0, bound, bestStartMaskState, -1);
            if (found) break;
            if (t === Infinity) break;
            bound = t;
        }

        const duration = (performance.now() - startTime).toFixed(1);

        // ---------------------------------------------------------
        // 輸出結果與動畫整合
        // ---------------------------------------------------------
        if (found) {
            let solutionStr = path.join(" ");
            let prefixStr = bestCandidate.name;
            let finalDisplay = prefixStr ? `${prefixStr} ${solutionStr}` : solutionStr;
            const stepCount = path.length;
            
            output.innerText = finalDisplay;
            output.style.color = "#00E5FF";
            
            // --- 反向公式計算 (Setup) ---
            const invertMove = (m) => {
                if(!m) return "";
                if(m.endsWith("'")) return m.slice(0, -1); 
                if(m.endsWith("2")) return m; 
                return m + "'"; 
            };

            let invPath = [...path].reverse().map(invertMove);
            let invSetup = [];
            if(prefixStr) {
                invSetup = prefixStr.split(" ").reverse().map(invertMove);
            }

            // [修正關鍵]: 定義錨點旋轉 (Anchor Rotation)
            const ANCHOR_ROTATIONS = {
                'U': '',
                'D': 'x2',
                'F': "x'", 
                'B': 'x',
                'R': 'z',
                'L': "z'"
            };
            
            // 取得對應的錨點旋轉
            const anchor = ANCHOR_ROTATIONS[targetFaceVal] || '';

            let fullInverseParts = [...invPath, ...invSetup];
            if (anchor) {
                if (fullInverseParts.length > 0) {
                    const firstMove = fullInverseParts[0];
                    const axis = anchor.charAt(0); // 取出 x, y, 或 z

                    // 檢查第一步是否為同軸旋轉 (例如 anchor='z', firstMove='z' 或 'z'' 或 'z2')
                    if (firstMove.startsWith(axis)) {
                        
                        // 定義旋轉值的簡單映射
                        const getVal = (m) => {
                            if (m.endsWith("2")) return 2;
                            if (m.endsWith("'")) return -1;
                            return 1;
                        };

                        // 計算合併後的旋轉值 (Anchor + FirstMove)
                        let sum = getVal(anchor) + getVal(firstMove);
                        
                        // 正規化結果 (-2, 2 -> '2'; -1, 3 -> "'"; 1, -3 -> ""; 0 -> 抵銷)
                        // 這裡簡化處理常見狀況
                        let newSuffix = "";
                        let shouldRemove = false;

                        if (sum === 0 || sum === 4 || sum === -4) {
                            shouldRemove = true; // 互相抵銷 (例如 z + z')
                        } else if (sum === 2 || sum === -2) {
                            newSuffix = "2"; // (例如 z + z -> z2)
                        } else if (sum === -1 || sum === 3) {
                            newSuffix = "'"; // (例如 z2 + z -> z')
                        } else if (sum === 1 || sum === -3) {
                            newSuffix = "";  // (例如 z2 + z' -> z)
                        }

                        if (shouldRemove) {
                            fullInverseParts.shift(); // 移除原本的第一步，且不加入 Anchor
                        } else {
                            // 更新原本的第一步為合併後的結果
                            fullInverseParts[0] = axis + newSuffix;
                        }
                    } else {
                        // 不同軸，直接插入
                        fullInverseParts.unshift(anchor);
                    }
                } else {
                    // 陣列為空，直接插入
                    fullInverseParts.unshift(anchor);
                }
            }
            
            let fullInverse = fullInverseParts.join(" ");
            
            if(outputInv) {
                outputInv.innerText = fullInverse;
            }

            stats.innerText = `${stepCount} Moves${prefixStr ? ' (+Setup)' : ''}|Time: ${duration}ms`;

            // --- 整合 TwistyPlayer ---
            if (player) {
                // 設定解法 (正向)
                player.alg = finalDisplay;
                
                // 設定 Setup (包含修正方位的錨點)
                player.experimentalSetupAlg = fullInverse;
                
                player.timestamp = 0;
                player.play();

                if (player) {
                player.alg = finalDisplay;
                player.experimentalSetupAlg = fullInverse;
                player.timestamp = 0;
                player.play();
                
                // [新增] 手機版/iPad版 自動切換到「動畫預覽」分頁
                // 檢查條件：螢幕寬度小於 900px (對應 CSS media query)
                if (window.innerWidth <= 900) {
                    switchMobileTab('preview');
                }
            }
                
                // 手機版自動切換到預覽分頁
                if (window.innerWidth <= 900) {
                    switchMobileTab('preview');
                }
            }

        } else {
            output.innerText = "無解 (檢查填色)";
            if(outputInv) outputInv.innerText = "";
            output.style.color = "#FF4444";
            stats.innerText = `Nodes: ${totalNodes}`;
            
            if (player) {
                player.alg = "";
                player.experimentalSetupAlg = "";
            }
        }

    }, 50);
}

// --- 初始化 PDB 表格 (僅需執行一次) ---
function initPDB() {
    // 16MB 表格，存放到達目標 (U面全滿) 的步數
    PDB_TABLE = new Int8Array(1 << 24).fill(-1);
    
    // 目標狀態：U面 (0,1,2,3) 為 1，其餘為 0
    const targetMask = (1<<0) | (1<<1) | (1<<2) | (1<<3);
    
    let queue = [targetMask];
    PDB_TABLE[targetMask] = 0;
    
    let head = 0;
    while(head < queue.length) {
        const mask = queue[head++];
        const dist = PDB_TABLE[mask];
        
        // 限制深度 (一般 6-7 步即可)
        if (dist >= 8) continue;

        // 必須遍歷所有 42 種移動 (含旋轉)
        // 這樣 PDB 才能告訴 Solver：「雖然現在白色在側面，但轉個 x 只需要 1 步就能到頂面」
        for (let m = 0; m < 42; m++) {
            const nextMask = applyPermToMaskInPDB(mask, m);
            
            if (PDB_TABLE[nextMask] === -1) {
                PDB_TABLE[nextMask] = dist + 1;
                queue.push(nextMask);
            }
        }
    }
    
    // 生成 6 個面的變換表
    generateTransforms();
}

// PDB 專用的快速 Permutation (不需建立新物件)
function applyPermToMaskInPDB(mask, moveIdx) {
    let res = 0;
    const p = PERM_TABLE[moveIdx];
    // 這裡我們手動展開迴圈或優化? JS JIT 已經夠快了
    for(let i=0; i<24; i++) {
        // 如果來源位置 p[i] 有 bit，則目標 i 也有 bit
        if ((mask >> p[i]) & 1) {
            res |= (1 << i);
        }
    }
    return res;
}

function generateTransforms() {
    FACE_TRANSFORMS = new Array(6);
    
    // 組合兩個移動的 helper
    const combine = (m1, m2) => {
        const idx1 = MOVE_NAMES.indexOf(m1);
        const idx2 = MOVE_NAMES.indexOf(m2);
        const p1 = PERM_TABLE[idx1];
        const p2 = PERM_TABLE[idx2];
        const res = new Int8Array(24);
        for(let i=0; i<24; i++) res[i] = p1[p2[i]];
        return res;
    };
    
    // 0: Target U -> Identity
    FACE_TRANSFORMS[0] = new Int8Array(24).map((_,i)=>i);
    
    // 1: Target D -> x2 (Rw2 Lw2)
    FACE_TRANSFORMS[1] = combine("Rw2", "Lw2");
    
    // 2: Target F -> x (Rw Lw') -> Moves F to U
    FACE_TRANSFORMS[2] = combine("Rw", "Lw'");
    
    // 3: Target B -> x' (Rw' Lw)
    FACE_TRANSFORMS[3] = combine("Rw'", "Lw");
    
    // 4: Target R -> z' (Fw' Bw) -> Moves R to U (Wait, z' moves R->U? Yes, z moves U->R)
    // 確保這裡的邏輯是將「目標面」轉到「U面」
    FACE_TRANSFORMS[4] = combine("Fw'", "Bw");
    
    // 5: Target L -> z (Fw Bw')
    FACE_TRANSFORMS[5] = combine("Fw", "Bw'");
}

/* =========================================================
   UI 互動：手機版分頁切換 (參考另一個專案)
   ========================================================= */
/* --- 貼在 script.js 最底部，替換原本的 switchMobileTab --- */
function switchMobileTab(tabName) {
    // 1. 移除按鈕 active 狀態
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(btn => btn.classList.remove('active'));

    // 2. 隱藏所有 Pane
    const tabInput = document.getElementById('tab-input');
    const tabPreview = document.getElementById('tab-preview');
    
    if(tabInput) tabInput.classList.remove('active');
    if(tabPreview) tabPreview.classList.remove('active');

    // 3. 根據選擇激活對應項目，並強制觸發重繪
    if (tabName === 'input') {
        if(tabs[0]) tabs[0].classList.add('active');
        if(tabInput) tabInput.classList.add('active');
        
        // [核心修正] 切換回填色模式時，Three.js 的 Canvas 尺寸可能會錯亂
        // 必須延遲觸發 onResize，等待 CSS Flexbox 完成佈局
        setTimeout(() => {
            if (typeof onResize === 'function') {
                onResize(); 
            }
        }, 50);
        
    } else {
        if(tabs[1]) tabs[1].classList.add('active');
        if(tabPreview) tabPreview.classList.add('active');
        
        // 觸發 resize 確保 twisty-player 正確渲染
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }
}
// 綁定到 window 確保 HTML onclick 找得到
window.switchMobileTab = switchMobileTab;