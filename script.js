/* =========================================================
   1. 配置與常數
   ========================================================= */
const PALETTE = [
    { id: 'W', hex: 0xFFFFFF, name: 'White' },
    { id: 'Y', hex: 0xFFFF00, name: 'Yellow' },
    { id: 'G', hex: 0x00FF00, name: 'Green' },
    { id: 'R', hex: 0xFF0000, name: 'Red' },
    { id: 'B', hex: 0x0000FF, name: 'Blue' },
    { id: 'O', hex: 0xFFA500, name: 'Orange' }
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

    // 先給定一個初始值，避免除以 0 的錯誤，稍後 ResizeObserver 會自動修正
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight || 1, 0.1, 100);
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // [修改] 初始先不設定具體大小，交由 onResize 處理
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // [修改] 修正 renderer 的 style 確保絕對定位不跑版
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '0'; // 確保在 UI 之下
    // [新增] 強制設定寬高為 100% 避免初始渲染溢出
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    
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
    
    // [新增] 使用 ResizeObserver 監聽容器大小變化 (解決 iOS Flexbox 延遲問題的核心)
    const resizeObserver = new ResizeObserver(() => {
        onResize();
    });
    resizeObserver.observe(container);

    // 保留視窗縮放監聽作為備案
    window.addEventListener('resize', onResize);
    
    // [新增] 雙重保險：立即執行一次，並在稍後 CSS 穩定後再執行一次
    onResize();
    setTimeout(onResize, 50);

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
    // 1. 重置狀態陣列 (邏輯數據)
    cubeState.fill(-1);
    
    // 2. 定義未填色時的顏色 (需與 create4x4Cube 中的 EMPTY_COLOR 一致)
    const EMPTY_COLOR = 0x282828; 

    // 3. 遍歷所有方塊進行重置 (不分中心或邊塊，全部重刷)
    if (cubeGroup && cubeGroup.children) {
        cubeGroup.children.forEach(mesh => {
            // 檢查該 mesh 是否有材質陣列
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => {
                    // 只要不是核心黑色(0x000000)，就重置為灰色
                    // 這樣可以把相機掃描到的邊塊/角塊顏色也一併清除
                    if(m.color.getHex() !== 0x000000) {
                        m.color.setHex(EMPTY_COLOR);
                    }
                });
            }
        });
    }

    // 4. 重置 UI 文字
    document.getElementById('solution-text').innerText = "READY";
    document.getElementById('solution-text').style.color = "#FFD60A";
    
    // 清空反向公式
    const invText = document.getElementById('inverse-solution-text');
    if(invText) invText.innerText = "";
    
    document.getElementById('solution-stats').innerText = "";
}

function onResize() {
    // [修改] ID 改為 canvas-wrapper
    const container = document.getElementById('canvas-wrapper');
    if (!container) return; // 安全檢查
    
    const width = container.clientWidth;
    const height = container.clientHeight;

    // [新增] 防止因為容器被隱藏 (display: none) 導致長寬為 0 而報錯
    if (width === 0 || height === 0) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    
    renderer.setSize(width, height);
    
    // [新增] 確保 Canvas 樣式不會被 Three.js 的行內樣式強行撐大
    // 雖然 setSize 會設定 width/height 屬性，但 CSS style 優先權更高，確保不溢出
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
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
/* =========================================================
   Solver 核心邏輯 (IDA* + 位元狀態壓縮 + TwistyPlayer 整合)
   [修改說明] 已新增過濾 Bw, Dw, Fw, Lw 的功能
   ========================================================= */
/* =========================================================
   極速 Solver 模組 (Bitwise IDA* + Transposition Table)
   [優化] 解決禁用移動後路徑搜尋過久的問題
   ========================================================= */

// 預先計算好的位元置換表 (Lazy Loading)
let BIT_PERM_TABLE = null;

function solveCenters() {
    // 0. UI 元素與初始化
    const output = document.getElementById('solution-text');
    const outputInv = document.getElementById('inverse-solution-text');
    const stats = document.getElementById('solution-stats');
    const player = document.getElementById('solution-player');
    const startTime = performance.now();

    // 1. 強制鎖定白(0)與黃(1)邏輯
    // 在 PALETTE 定義中：Index 0 = White, Index 1 = Yellow
    const IDX_WHITE = 0;
    const IDX_YELLOW = 1;

    let whiteCount = 0;
    let yellowCount = 0;

    // 遍歷目前的魔方狀態計算白黃數量
    cubeState.forEach(c => { 
        if (c === IDX_WHITE) whiteCount++;
        if (c === IDX_YELLOW) yellowCount++;
    });

    // 嚴格檢查：只允許白黃各 4 格，忽略其他顏色
    // 這樣相機掃描(6色全滿)可以通過，手動輸入(只填白黃)也可以通過
    if (whiteCount !== 4 || yellowCount !== 4) {
        output.innerText = "Error";
        stats.innerText = `需白、黃各 4 格\n目前: 白=${whiteCount}, 黃=${yellowCount}`;
        output.style.color = "#FF4444";
        return;
    }

    const wId = IDX_WHITE;
    const yId = IDX_YELLOW;

    // 2. 準備 PDB 與 加速表
    if (!PDB_TABLE) initPDB();
    
    // 建立位元置換表 (僅第一次執行時建立)
    if (!BIT_PERM_TABLE) {
        BIT_PERM_TABLE = new Array(36); // 只處理 0-35 的移動
        for (let m = 0; m < 36; m++) {
            const p = PERM_TABLE[m];
            const map = new Int32Array(24);
            for(let i=0; i<24; i++) map[i] = p[i];
            BIT_PERM_TABLE[m] = map;
        }
    }

    // 3. 獲取使用者設定 (Target & Bans)
    const targetSelect = document.getElementById('target-face');
    const targetFaceVal = targetSelect ? targetSelect.value : 'U';
    
    const bannedPrefixes = [];
    if (document.getElementById('ban-bw')?.checked) bannedPrefixes.push("Bw");
    if (document.getElementById('ban-dw')?.checked) bannedPrefixes.push("Dw");
    if (document.getElementById('ban-fw')?.checked) bannedPrefixes.push("Fw");
    if (document.getElementById('ban-lw')?.checked) bannedPrefixes.push("Lw");

    const FACE_MAP = { 'U': 0, 'D': 1, 'F': 2, 'B': 3, 'R': 4, 'L': 5 };
    const OPPOSITE_MAP = { 0: 1, 1: 0, 2: 3, 3: 2, 4: 5, 5: 4 };
    const targetIdx = FACE_MAP[targetFaceVal];
    const oppIdx = OPPOSITE_MAP[targetIdx];

    // 4. 建立可用移動列表 (Filtered Moves)
    let availableMoves = [];
    for (let i = 0; i < 36; i++) {
        const name = MOVE_NAMES[i];
        let isBanned = false;
        for (const prefix of bannedPrefixes) {
            if (name.startsWith(prefix)) { isBanned = true; break; }
        }
        if (!isBanned) availableMoves.push(i);
    }

    // 排序優化
    availableMoves.sort((a, b) => {
        const isBadA = MOVE_NAMES[a].includes("Bw") || MOVE_NAMES[a].includes("Dw");
        const isBadB = MOVE_NAMES[b].includes("Bw") || MOVE_NAMES[b].includes("Dw");
        if (isBadA !== isBadB) return isBadA ? 1 : -1;
        return 0;
    });

    output.innerText = "CALCULATING...";
    output.style.color = "#FFD60A";
    if (outputInv) outputInv.innerText = "";
    stats.innerText = "";

    // 使用 setTimeout 讓 UI 渲染 "CALCULATING..."
    setTimeout(() => {
        // --- 狀態轉換：Array -> BitMask ---
        let initialWMask = 0, initialYMask = 0;
        for(let i=0; i<24; i++) {
            if (cubeState[i] === wId) initialWMask |= (1 << i);
            else if (cubeState[i] === yId) initialYMask |= (1 << i);
        }

        // --- 內部 Helper: 位元操作 ---
        const applyMoveBit = (mask, moveIdx) => {
            const map = BIT_PERM_TABLE[moveIdx];
            let res = 0;
            for(let i=0; i<24; i++) {
                if ((mask >> map[i]) & 1) res |= (1 << i);
            }
            return res;
        };

        const applyPermToMaskFast = (mask, transformArray) => {
            let res = 0;
            for(let i=0; i<24; i++) {
                if ((mask >> transformArray[i]) & 1) res |= (1 << i);
            }
            return res;
        };

        // --- 啟發函式 (Heuristic) ---
        const wTrans = FACE_TRANSFORMS[targetIdx];
        const yTrans = FACE_TRANSFORMS[oppIdx];

        const getH_Bit = (wMask, yMask) => {
            const wOnU = applyPermToMaskFast(wMask, wTrans);
            const yOnU = applyPermToMaskFast(yMask, yTrans);
            return Math.max(PDB_TABLE[wOnU], PDB_TABLE[yOnU]);
        };

        // --- Pre-scan: 選擇最佳起手勢 (Orientation) ---
        const orientationDefs = [
            { name: "",       moves: [] },
            { name: "y",      moves: ["y"] }, { name: "y'",     moves: ["y'"] }, { name: "y2",     moves: ["y","y"] },
            { name: "x",      moves: ["x"] }, { name: "x'",     moves: ["x'"] }, { name: "x2",     moves: ["x","x"] },
            { name: "z",      moves: ["z"] }, { name: "z'",     moves: ["z'"] }, { name: "z2",     moves: ["z","z"] },
            { name: "x y",    moves: ["x","y"] }, { name: "x y'",   moves: ["x","y'"] },
            { name: "x' y",   moves: ["x'","y"] }, { name: "x' y'",  moves: ["x'","y'"] }
        ];

        let bestStartW = 0, bestStartY = 0, bestPrefix = null, minH = 99;

        for(let orient of orientationDefs) {
            let w = initialWMask, y = initialYMask;
            for(let mName of orient.moves) {
                const idx = MOVE_NAMES.indexOf(mName);
                if(idx !== -1) {
                    w = applyPermToMaskInPDB(w, idx);
                    y = applyPermToMaskInPDB(y, idx);
                }
            }
            const h = getH_Bit(w, y);
            if(h < minH) {
                minH = h;
                bestStartW = w;
                bestStartY = y;
                bestPrefix = orient;
            }
        }

        // --- IDA* 核心 ---
        let path = [];
        let found = false;
        let totalNodes = 0;
        
        // 置換表 (Transposition Table)
        const tt = new Map();

        const search = (g, bound, wMask, yMask, lastMoveFace) => {
            totalNodes++;
            
            const h = getH_Bit(wMask, yMask);
            const f = g + h;
            if (f > bound) return f;
            if (h === 0) {
                found = true;
                return f;
            }

            // TT Lookup
            const stateKey = wMask + (yMask * 16777216);
            const visitedG = tt.get(stateKey);
            if (visitedG !== undefined && visitedG <= g) {
                return Infinity;
            }
            tt.set(stateKey, g);

            let min = Infinity;

            for (let i = 0; i < availableMoves.length; i++) {
                const m = availableMoves[i];
                const currentFace = (m / 3) | 0;
                const currentAxis = (currentFace / 4) | 0;

                // 移動剪枝
                if (lastMoveFace !== -1) {
                    const lastAxis = (lastMoveFace / 4) | 0;
                    if (currentAxis === lastAxis && currentFace <= lastMoveFace) continue;
                }

                // 狀態更新
                const nextW = applyMoveBit(wMask, m);
                const nextY = applyMoveBit(yMask, m);

                path.push(MOVE_NAMES[m]);
                
                const t = search(g + 1, bound, nextW, nextY, currentFace);
                
                if (found) return t;
                path.pop();
                
                if (t < min) min = t;
            }
            return min;
        };

        // 執行 IDA*
        let bound = minH;
        const MAX_DEPTH = 16; 
        
        while (!found && bound <= MAX_DEPTH) {
            tt.clear();
            const t = search(0, bound, bestStartW, bestStartY, -1);
            if (found) break;
            if (t === Infinity) break;
            bound = t;
        }

        const duration = (performance.now() - startTime).toFixed(0);

        // 5. 輸出結果
        if (found) {
            const solutionStr = path.join(" ");
            const prefixStr = bestPrefix.name;
            const fullSol = prefixStr ? `${prefixStr} ${solutionStr}` : solutionStr;
            
            output.innerText = fullSol;
            output.style.color = "#00E5FF";

            // 反向公式計算
            const invertMove = (m) => {
                if(!m) return "";
                if(m.endsWith("'")) return m.slice(0, -1); 
                if(m.endsWith("2")) return m; 
                return m + "'"; 
            };
            const invPath = [...path].reverse().map(invertMove);
            const invSetup = prefixStr ? prefixStr.split(" ").reverse().map(invertMove) : [];
            
            const ANCHOR_MAP = { 'U':'', 'D':'x2', 'F':"x'", 'B':'x', 'R':'z', 'L':"z'" };
            const anchor = ANCHOR_MAP[targetFaceVal];
            
            let fullInvParts = [...invPath, ...invSetup];
            if(anchor) fullInvParts.unshift(anchor);
            
            if (outputInv) outputInv.innerText = fullInvParts.join(" ");
            stats.innerText = `${path.length} Moves (${duration}ms / ${totalNodes} nodes)`;

            if (player) {
                player.alg = fullSol;
                player.experimentalSetupAlg = fullInvParts.join(" ");
                player.timestamp = 0;
                if(window.innerWidth <= 900 && typeof switchMobileTab === 'function') {
                    switchMobileTab('preview');
                }
            }
        } else {
            output.innerText = "無法在限時內找到解";
            output.style.color = "#FF4444";
            stats.innerText = `Nodes: ${totalNodes}`;
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

/* =========================================================
   [新增] 4x4 相機掃描功能模組 (移植與適配版)
   ========================================================= */

let stream = null;
let currentFaceIndex = 0;
// 掃描順序: U(白) -> F(綠) -> R(紅) -> B(藍) -> L(橘) -> D(黃)
const SCAN_ORDER = ['U', 'F', 'R', 'B', 'L', 'D'];

const FACE_LABELS = {
    'U': '掃描頂面 (Up)',
    'F': '掃描前面 (Front)',
    'R': '掃描右面 (Right)',
    'B': '掃描後面 (Back)',
    'L': '掃描左面 (Left)',
    'D': '掃描底面 (Down)'
};

// 周邊提示 (4x4 版) - 邏輯與 3x3 相同
const ADJACENT_HINTS = {
    'U': { top: 'B (藍)', right: 'R (紅)', bottom: 'F (綠)', left: 'L (橘)' },
    'F': { top: 'U (白)', right: 'R (紅)', bottom: 'D (黃)', left: 'L (橘)' },
    'R': { top: 'U (白)', right: 'B (藍)', bottom: 'D (黃)', left: 'F (綠)' },
    'B': { top: 'U (白)', right: 'L (橘)', bottom: 'D (黃)', left: 'R (紅)' },
    'L': { top: 'U (白)', right: 'F (綠)', bottom: 'D (黃)', left: 'B (藍)' },
    'D': { top: 'F (綠)', right: 'R (紅)', bottom: 'B (藍)', left: 'L (橘)' }
};

// 顏色映射 (名稱轉 Hex)
const CAM_COLOR_MAP = {
    'white': 0xFFFFFF,
    'yellow': 0xFFFF00,
    'green': 0x00FF00,
    'red': 0xFF0000,
    'orange': 0xFFA500,
    'blue': 0x0000FF
};

let animationFrameId = null;

// 1. 啟動掃描流程
async function startCameraScanFlow() {
    // 重置 3D 方塊顏色為空色，準備接收新數據
    resetCube(); 
    
    currentFaceIndex = 0;
    document.getElementById('camera-modal').style.display = 'flex';
    
    // 如果是手機，自動切換到 Input 分頁
    if(window.innerWidth <= 900) switchMobileTab('input');

    await startCamera();
}
window.startCameraScanFlow = startCameraScanFlow;

// 2. 啟動相機
async function startCamera() {
    const video = document.getElementById('video');
    const faceIndicator = document.getElementById('face-indicator');
    const gridCanvas = document.getElementById('grid-canvas');
    const msg = document.getElementById('scan-message');

    try {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        
        // 請求後置鏡頭
        stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: 'environment', 
                width: { ideal: 720 }, 
                height: { ideal: 720 } 
            }
        });
        
        video.srcObject = stream;

        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                gridCanvas.width = video.videoWidth;
                gridCanvas.height = video.videoHeight;
                resolve();
            };
        });

        // 更新 UI
        if(currentFaceIndex < SCAN_ORDER.length) {
            const face = SCAN_ORDER[currentFaceIndex];
            faceIndicator.innerText = `${currentFaceIndex + 1}/6: ${FACE_LABELS[face]}`;
            msg.innerText = "請保持方塊穩定...";
        }
        
        drawGrid();
        startRealTimeDetection();

    } catch (error) {
        alert('無法啟動相機，請檢查權限或設備。');
        console.error('Camera error:', error);
        stopCamera();
    }
}

// 3. 關閉相機
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    stopRealTimeDetection();
    document.getElementById('camera-modal').style.display = 'none';
}
window.stopCamera = stopCamera;

// 4. 繪製 4x4 網格
function drawGrid() {
    const gridCanvas = document.getElementById('grid-canvas');
    const ctx = gridCanvas.getContext('2d');
    
    if (gridCanvas.width < 50) return { startX: 0, startY: 0, cellSize: 0 };

    ctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);

    // 計算網格大小 (佔畫面 70% - 4x4 需要比較大的空間)
    const size = Math.min(gridCanvas.width, gridCanvas.height) * 0.7;
    const startX = (gridCanvas.width - size) / 2;
    const startY = (gridCanvas.height - size) / 2;
    const cellSize = size / 4; // 4x4 的關鍵修改

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;

    ctx.beginPath();
    // 繪製 5 條線 (4格)
    for (let i = 0; i <= 4; i++) {
        // 橫線
        ctx.moveTo(startX, startY + i * cellSize);
        ctx.lineTo(startX + size, startY + i * cellSize);
        // 直線
        ctx.moveTo(startX + i * cellSize, startY);
        ctx.lineTo(startX + i * cellSize, startY + size);
    }
    ctx.stroke();

    // 繪製文字提示
    if (currentFaceIndex < SCAN_ORDER.length) {
        const faceChar = SCAN_ORDER[currentFaceIndex];
        const hints = ADJACENT_HINTS[faceChar];

        if (hints) {
            ctx.font = 'bold 24px "JetBrains Mono", monospace';
            ctx.fillStyle = '#FFD60A';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;

            ctx.textAlign = 'center';
            ctx.fillText(hints.top, startX + size / 2, startY - 25);
            ctx.fillText(hints.bottom, startX + size / 2, startY + size + 25);

            ctx.textAlign = 'right';
            ctx.fillText(hints.left, startX - 15, startY + size / 2);

            ctx.textAlign = 'left';
            ctx.fillText(hints.right, startX + size + 15, startY + size / 2);
        }
    }

    return { startX, startY, cellSize };
}

// 5. HSV 轉換
function rgbToHsv(r, g, b) {
    r /= 255, g /= 255, b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h, s = max === 0 ? 0 : d / max, v = max;
    if (max === min) h = 0;
    else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s * 100, v * 100];
}

// 6. 顏色判定 (使用寬容度較高的範圍)
function detectColor(r, g, b) {
    const [h, s, v] = rgbToHsv(r, g, b);
    
    const colorRanges = {
        'orange': { h: [5, 25], s: [20, 100], v: [30, 100] },
        'red': { h: [350, 5], s: [40, 100], v: [20, 100] },
        'yellow': { h: [50, 70], s: [50, 100], v: [60, 100] }, 
        'green': { h: [100, 150], s: [40, 100], v: [30, 100] },
        'blue': { h: [210, 270], s: [50, 100], v: [30, 100] },
        'white': { h: [0, 360], s: [0, 25], v: [50, 100] } 
    };

    for (const [color, range] of Object.entries(colorRanges)) {
        let hInRange;
        if (color === 'red') {
            hInRange = (h >= range.h[0] && h <= 360) || (h >= 0 && h <= range.h[1]);
        } else {
            hInRange = h >= range.h[0] && h <= range.h[1];
        }
        
        if (hInRange && s >= range.s[0] && s <= range.s[1] && v >= range.v[0] && v <= range.v[1]) {
            return color;
        }
    }
    return 'white';
}

// 7. 即時偵測 (4x4 核心邏輯)
function startRealTimeDetection() {
    const video = document.getElementById('video');
    const gridCanvas = document.getElementById('grid-canvas');
    const ctx = gridCanvas.getContext('2d');
    const msg = document.getElementById('scan-message');
    const captureCanvas = document.getElementById('capture-canvas');
    const capCtx = captureCanvas.getContext('2d');

    let frameCount = 0;
    const requiredFrames = 20; // 穩定鎖定幀數
    let lastColors = null;

    function detectAndDraw() {
        if (!video.srcObject || gridCanvas.width < 50) return;

        if (captureCanvas.width !== video.videoWidth) {
            captureCanvas.width = video.videoWidth;
            captureCanvas.height = video.videoHeight;
        }

        capCtx.drawImage(video, 0, 0);
        
        const { startX, startY, cellSize } = drawGrid();
        
        const currentFrameColors = [];
        let isAllWhite = true;

        // 掃描 4x4 = 16格
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                // 中心採樣
                const sampleX = startX + x * cellSize + cellSize * 0.25;
                const sampleY = startY + y * cellSize + cellSize * 0.25;
                const sampleW = cellSize * 0.5;
                
                const pixelData = capCtx.getImageData(sampleX, sampleY, sampleW, sampleW);
                let rSum = 0, gSum = 0, bSum = 0;
                
                for (let i = 0; i < pixelData.data.length; i += 4) {
                    rSum += pixelData.data[i];
                    gSum += pixelData.data[i+1];
                    bSum += pixelData.data[i+2];
                }
                
                const count = pixelData.data.length / 4;
                const colorName = detectColor(rSum/count, gSum/count, bSum/count);
                currentFrameColors.push(colorName);

                if (colorName !== 'white') isAllWhite = false;

                // 繪製即時回饋框
                ctx.lineWidth = 4;
                ctx.strokeStyle = colorName === 'white' ? '#ddd' : colorName;
                ctx.strokeRect(startX + x * cellSize, startY + y * cellSize, cellSize, cellSize);
            }
        }

        // 防抖邏輯
        if (lastColors && currentFrameColors.every((c, i) => c === lastColors[i])) {
            frameCount++;
            if (frameCount > 5) {
                msg.innerText = `鎖定中... ${(frameCount/requiredFrames*100).toFixed(0)}%`;
            }
            if (frameCount >= requiredFrames && !isAllWhite) {
                cancelAnimationFrame(animationFrameId);
                showConfirmationButtons(currentFrameColors);
                msg.innerText = "已鎖定！請確認";
                return;
            }
        } else {
            frameCount = 0;
            lastColors = [...currentFrameColors];
            msg.innerText = "請保持方塊穩定...";
            const oldBtns = document.getElementById('button-container');
            if(oldBtns) oldBtns.remove();
        }

        animationFrameId = requestAnimationFrame(detectAndDraw);
    }

    animationFrameId = requestAnimationFrame(detectAndDraw);
}

function stopRealTimeDetection() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    const oldBtns = document.getElementById('button-container');
    if(oldBtns) oldBtns.remove();
}

function showConfirmationButtons(colors) {
    const container = document.getElementById('camera-container');
    if(document.getElementById('button-container')) return;

    const btnDiv = document.createElement('div');
    btnDiv.id = 'button-container';
    
    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'confirm-btn';
    btnConfirm.innerText = '✅ 確認';
    btnConfirm.onclick = () => processCapturedColors(colors);

    const btnRetry = document.createElement('button');
    btnRetry.className = 'retry-btn';
    btnRetry.innerText = '↺ 重試';
    btnRetry.onclick = () => {
        btnDiv.remove();
        startRealTimeDetection();
    };

    btnDiv.appendChild(btnRetry);
    btnDiv.appendChild(btnConfirm);
    container.appendChild(btnDiv);
}

// 8. 處理顏色並應用到 4x4 魔方
function processCapturedColors(colorNames) {
    const targetFace = SCAN_ORDER[currentFaceIndex];
    const hexColors = colorNames.map(name => CAM_COLOR_MAP[name] || 0x282828);
    
    // 呼叫 4x4 專用填色函式
    applyColorsTo4x4Face(targetFace, hexColors);
    
    currentFaceIndex++;
    document.getElementById('button-container').remove();

    if (currentFaceIndex < SCAN_ORDER.length) {
        const faceIndicator = document.getElementById('face-indicator');
        const face = SCAN_ORDER[currentFaceIndex];
        faceIndicator.innerText = `${currentFaceIndex + 1}/6: ${FACE_LABELS[face]}`;
        startRealTimeDetection();
    } else {
        stopCamera();
        alert('掃描完成！準備計算...');
        solveCenters(); // 自動開始計算
    }
}

// 9. [核心] 將 16 個顏色映射到 4x4 面的 Mesh，並識別中心塊更新 State
function applyColorsTo4x4Face(faceChar, hexArray) {
    // hexArray 順序 (Row-Major): 0-3 (Row1), 4-7 (Row2), 8-11 (Row3), 12-15 (Row4)
    
    // 找出該面的所有 Meshes
    let faceMeshes = [];
    cubeGroup.children.forEach(mesh => {
        const { x, y, z } = mesh.userData;
        
        let isFace = false;
        // 4x4 座標系統範圍約 -1.5 到 1.5
        // 誤差容許 (因為浮點數)
        if (faceChar === 'U' && Math.abs(y - 1.5) < 0.1) isFace = true;
        if (faceChar === 'D' && Math.abs(y + 1.5) < 0.1) isFace = true;
        if (faceChar === 'R' && Math.abs(x - 1.5) < 0.1) isFace = true;
        if (faceChar === 'L' && Math.abs(x + 1.5) < 0.1) isFace = true;
        if (faceChar === 'F' && Math.abs(z - 1.5) < 0.1) isFace = true;
        if (faceChar === 'B' && Math.abs(z + 1.5) < 0.1) isFace = true;
        
        if (isFace) faceMeshes.push(mesh);
    });

    // 排序 Meshes 以匹配掃描順序 (Row-Major: 左上 -> 右下)
    faceMeshes.sort((a, b) => {
        const ad = a.userData;
        const bd = b.userData;
        
        if (faceChar === 'U') { 
            // 上面: 後->前 (Z: -1.5 -> 1.5), 左->右 (X: -1.5 -> 1.5)
            // 標準掃描順序通常是從「背對你的那排」開始，還是「靠近你的那排」？
            // 參考 3x3 邏輯：Row 1 是 Z最小(Back)，Row 4 是 Z最大(Front)
            if (Math.abs(ad.z - bd.z) > 0.1) return ad.z - bd.z;
            return ad.x - bd.x;
        }
        if (faceChar === 'F') {
            // 正面: 上->下 (Y: 1.5 -> -1.5), 左->右 (X: -1.5 -> 1.5)
            if (Math.abs(ad.y - bd.y) > 0.1) return bd.y - ad.y;
            return ad.x - bd.x;
        }
        if (faceChar === 'R') {
            // 右面: 上->下, 前->後 (Z: 1.5 -> -1.5)
            if (Math.abs(ad.y - bd.y) > 0.1) return bd.y - ad.y;
            return bd.z - ad.z;
        }
        if (faceChar === 'B') {
            // 背面: 上->下, 右->左 (X: 1.5 -> -1.5，因為背面視角X反向)
            if (Math.abs(ad.y - bd.y) > 0.1) return bd.y - ad.y;
            return bd.x - ad.x;
        }
        if (faceChar === 'L') {
            // 左面: 上->下, 後->前 (Z: -1.5 -> 1.5)
            if (Math.abs(ad.y - bd.y) > 0.1) return bd.y - ad.y;
            return ad.z - bd.z;
        }
        if (faceChar === 'D') {
            // 底面: 前->後 (Z: 1.5 -> -1.5), 左->右 (X: -1.5 -> 1.5)
            // 底面翻上來看時，上方通常是 Front
            if (Math.abs(ad.z - bd.z) > 0.1) return bd.z - ad.z;
            return ad.x - bd.x;
        }
        return 0;
    });

    // 填色並更新 State
    faceMeshes.forEach((mesh, index) => {
        if (index >= 16) return;
        
        // 找到對應面的 Material Index
        let matIdx = -1;
        if (faceChar === 'R') matIdx = 0;
        if (faceChar === 'L') matIdx = 1;
        if (faceChar === 'U') matIdx = 2;
        if (faceChar === 'D') matIdx = 3;
        if (faceChar === 'F') matIdx = 4;
        if (faceChar === 'B') matIdx = 5;
        
        const hex = hexArray[index];
        if (matIdx !== -1) {
            // 設定視覺顏色
            mesh.material[matIdx].color.setHex(hex);
        }

        // [關鍵] 判斷這塊是否為中心塊，若是則更新 cubeState
        // 4x4 網格中，中心塊的 Index 為：5, 6, 9, 10
        // Row 0: 0 1 2 3
        // Row 1: 4 5 6 7
        // Row 2: 8 9 10 11
        // Row 3: 12 13 14 15
        const isCenterIndex = [5, 6, 9, 10].includes(index);
        
        if (isCenterIndex && mesh.userData.isCenter) {
            // 找出對應的 Palette Index (0-5)
            const paletteIdx = PALETTE.findIndex(p => p.hex === hex);
            const stateIdx = mesh.userData.index; // 這是 create4x4Cube 裡算好的 0-23 索引
            
            if (stateIdx !== -1 && paletteIdx !== -1) {
                cubeState[stateIdx] = paletteIdx;
            }
        }
    });
}