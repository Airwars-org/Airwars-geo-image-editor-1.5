const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const imageUpload = document.getElementById('imageUpload');
const fileUpload = document.getElementById('fileUpload');
const uploadImageBtn = document.getElementById('uploadImageBtn');
const openFileBtn = document.getElementById('openFileBtn');
const rectangleBtn = document.getElementById('rectangleBtn');
const polygonBtn = document.getElementById('polygonBtn');
const selectBtn = document.getElementById('selectBtn');
const labelBtn = document.getElementById('labelBtn');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadEditFileBtn = document.getElementById('downloadEditFileBtn');
const toolInfo = document.getElementById('toolInfo');
const labelInput = document.getElementById('editLabelInput');
const labelTextGroup = labelInput.closest('.control-group');
const editPanel = document.getElementById('editPanel');
const labelSideGroup = document.getElementById('labelSideGroup');
const dashedGroup = document.getElementById('dashedGroup');
const rotationGroup = document.getElementById('rotationGroup');
const rotationInput = document.getElementById('rotationInput');
const rotationValue = document.getElementById('rotationValue');
const resetRotationBtn = document.getElementById('resetRotationBtn');
const labelSideSelect = document.getElementById('labelSide');
const dashedCheckbox = document.getElementById('dashedCheckbox');
const deleteBtn = document.getElementById('deleteBtn');
const deselectBtn = document.getElementById('deselectBtn');
const caseCodeInput = document.getElementById('caseCodeInput');
const sourceInput = document.getElementById('sourceInput');
const filenamePreview = document.getElementById('filenamePreview');
const chooseFolderBtn = document.getElementById('chooseFolderBtn');
const folderPathDisplay = document.getElementById('folderPathDisplay');
const exactLocationBtn = document.getElementById('exactLocationBtn');
const groundModeBtn = document.getElementById('groundModeBtn');
const satelliteModeBtn = document.getElementById('satelliteModeBtn');

let selectedFolderHandle = null;

const DB_NAME = 'ImageEditorDB';
const DB_VERSION = 1;
const STORE_NAME = 'folderHandle';

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
}

async function saveFolderHandleToDB(handle) {
    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        return new Promise((resolve, reject) => {
            const request = store.put(handle, 'folderHandle');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.log('Could not save folder handle to DB');
    }
}

async function loadFolderHandleFromDB() {
    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        return new Promise((resolve, reject) => {
            const request = store.get('folderHandle');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.log('Could not load folder handle from DB');
        return null;
    }
}

let originalImage = null;
let resizedImage = null;
let currentMode = 'ground';
const modes = {
    ground: {
        annotations: [],
        currentTool: null,
        selectedAnnotationIndex: -1,
        rectangleAnchor: null,
        currentPath: [],
        tempPath: null,
        selectedHandle: null,
        dragStart: null
    },
    satellite: {
        annotations: [],
        currentTool: null,
        selectedAnnotationIndex: -1,
        rectangleAnchor: null,
        currentPath: [],
        tempPath: null,
        selectedHandle: null,
        dragStart: null
    }
};
let isDrawing = false;
let hoverAnnotationIndex = -1;
let hoverHandle = null;
let exactLocationGlowEnabled = true;

const historyStack = [];
const redoStack = [];
const HISTORY_LIMIT = 100;
let dragHistorySnapshot = null;
let rotationHistorySnapshot = null;

function captureHistorySnapshot() {
    return JSON.stringify({
        currentMode,
        exactLocationGlowEnabled,
        modes: {
            ground: modes.ground.annotations,
            satellite: modes.satellite.annotations
        }
    });
}

function pushHistorySnapshot(snapshot) {
    if (!snapshot) return;
    const currentSnapshot = captureHistorySnapshot();
    if (snapshot === currentSnapshot) return;
    historyStack.push(snapshot);
    if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
    redoStack.length = 0;
}

function restoreHistorySnapshot(snapshot) {
    if (!snapshot) return;
    const data = JSON.parse(snapshot);
    currentMode = data.currentMode;
    exactLocationGlowEnabled = data.exactLocationGlowEnabled;
    modes.ground.annotations = data.modes.ground;
    modes.satellite.annotations = data.modes.satellite;
    modes.ground.selectedAnnotationIndex = -1;
    modes.satellite.selectedAnnotationIndex = -1;
    modes.ground.selectedHandle = null;
    modes.satellite.selectedHandle = null;
    modes.ground.dragStart = null;
    modes.satellite.dragStart = null;
    modes.ground.rectangleAnchor = null;
    modes.satellite.rectangleAnchor = null;
    modes.ground.currentPath = [];
    modes.satellite.currentPath = [];
    modes.ground.tempPath = null;
    modes.satellite.tempPath = null;
    editPanel.style.visibility = 'hidden';
    labelInput.value = '';
    hoverAnnotationIndex = -1;
    hoverHandle = null;
    updateModeButtons();
    updateToolButtons();
    updateToolInfo();
    redraw();
}

function undo() {
    if (!historyStack.length) return;
    const previousSnapshot = historyStack.pop();
    redoStack.push(captureHistorySnapshot());
    restoreHistorySnapshot(previousSnapshot);
}

function redo() {
    if (!redoStack.length) return;
    const nextSnapshot = redoStack.pop();
    historyStack.push(captureHistorySnapshot());
    restoreHistorySnapshot(nextSnapshot);
}

const ANNOTATION_SCALE = 0.65;
const STROKE_WIDTH = 8 * ANNOTATION_SCALE;
const STROKE_COLOR = '#ff0000';
const TARGET_HEIGHT = 1260;
const MAX_IMAGE_WIDTH = 1826;
const LABEL_SIZE = 85 * ANNOTATION_SCALE;
const LABEL_FONT_SIZE = 60 * ANNOTATION_SCALE;
const LABEL_FONT = 'Atlas Grotesk Web Medium, sans-serif';
const DASH_PATTERN = [30 * ANNOTATION_SCALE, 15 * ANNOTATION_SCALE];
const EXACT_LOCATION_RADIUS = 17.5 * ANNOTATION_SCALE;
const EXACT_LOCATION_FONT_SIZE = LABEL_FONT_SIZE * 0.8;
const EXACT_LOCATION_FONT = 'Atlas Grotesk Web Regular, sans-serif';
const EXACT_LOCATION_LABEL_DISTANCE = 60 * ANNOTATION_SCALE;
const EXACT_LOCATION_LABEL_OFFSET = {
    x: EXACT_LOCATION_LABEL_DISTANCE * Math.cos(Math.PI / 4),
    y: -EXACT_LOCATION_LABEL_DISTANCE * Math.sin(Math.PI / 4)
};
const EXACT_LOCATION_DEFAULT_TEXT = 'Exact location';
const LABEL_Y_OFFSET = -8 * ANNOTATION_SCALE;
const LABEL_TEXT_Y_OFFSET = 2 * ANNOTATION_SCALE;
const SELECTION_HANDLE_SIZE = 12 * ANNOTATION_SCALE;
const SELECTION_HOVER_HANDLE_SIZE = 18 * ANNOTATION_SCALE;
const SELECTION_HANDLE_LINE_WIDTH = 2 * ANNOTATION_SCALE;
const HANDLE_HIT_THRESHOLD = 12 * ANNOTATION_SCALE;
const POLYLINE_VERTEX_HIT_THRESHOLD = 24 * ANNOTATION_SCALE;
const POLYLINE_HIT_THRESHOLD = POLYLINE_VERTEX_HIT_THRESHOLD;
const EXACT_LOCATION_SELECTION_RING_OFFSET = 4 * ANNOTATION_SCALE;
const EXACT_LOCATION_HIT_PADDING = 6 * ANNOTATION_SCALE;
const ANNOTATION_SHADOW_BLUR = 8 * ANNOTATION_SCALE;
const DEFAULT_ANNOTATION_DASHED = false;
const DEFAULT_RECTANGLE_LABEL_POSITION = 'right';

function getModeState() {
    return modes[currentMode];
}

function switchMode(mode) {
    if (!resizedImage) return;
    if (currentMode === mode) return;
    const before = captureHistorySnapshot();
    currentMode = mode;
    const state = getModeState();
    state.currentTool = null;
    state.selectedAnnotationIndex = -1;
    state.selectedHandle = null;
    state.dragStart = null;
    state.rectangleAnchor = null;
    state.currentPath = [];
    state.tempPath = null;
    editPanel.style.visibility = 'hidden';
    rotationGroup.style.visibility = 'hidden';
    hoverAnnotationIndex = -1;
    hoverHandle = null;
    updateModeButtons();
    updateToolButtons();
    updateToolInfo();
    pushHistorySnapshot(before);
    redraw();
}

function updateModeButtons() {
    groundModeBtn.classList.toggle('active', currentMode === 'ground');
    satelliteModeBtn.classList.toggle('active', currentMode === 'satellite');
}

function resetModeState(state) {
    state.annotations = [];
    state.currentTool = null;
    state.selectedAnnotationIndex = -1;
    state.rectangleAnchor = null;
    state.currentPath = [];
    state.tempPath = null;
    state.selectedHandle = null;
    state.dragStart = null;
}

function setToolButtonsEnabled(enabled) {
    rectangleBtn.disabled = !enabled;
    polygonBtn.disabled = !enabled;
    selectBtn.disabled = !enabled;
    labelBtn.disabled = !enabled;
    exactLocationBtn.disabled = !enabled;
    groundModeBtn.disabled = !enabled;
    satelliteModeBtn.disabled = !enabled;
}

imageUpload.addEventListener('change', (event) => {
    handleImageUpload(event.target.files[0]);
    event.target.value = '';
});
uploadImageBtn.addEventListener('click', chooseImageFile);
openFileBtn.addEventListener('click', chooseProjectFile);
rectangleBtn.addEventListener('click', () => selectTool('rectangle'));
polygonBtn.addEventListener('click', () => selectTool('polygon'));
selectBtn.addEventListener('click', () => selectTool('select'));
labelBtn.addEventListener('click', () => selectTool('label'));
exactLocationBtn.addEventListener('click', () => selectTool('exact-location'));
groundModeBtn.addEventListener('click', () => switchMode('ground'));
satelliteModeBtn.addEventListener('click', () => switchMode('satellite'));
clearBtn.addEventListener('click', clearAnnotations);
downloadBtn.addEventListener('click', downloadImage);
downloadEditFileBtn.addEventListener('click', downloadEditFile);
fileUpload.addEventListener('change', (event) => {
    handleFileUpload(event.target.files[0]);
    event.target.value = '';
});
labelInput.addEventListener('change', handleLabelInput);
labelInput.addEventListener('input', handleLabelInputRealtime);
labelInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleLabelInput();
    }
});
labelSideSelect.addEventListener('change', () => {
    const state = getModeState();
    if (state.selectedAnnotationIndex >= 0) {
        const before = captureHistorySnapshot();
        state.annotations[state.selectedAnnotationIndex].labelPosition = labelSideSelect.value;
        pushHistorySnapshot(before);
        redraw();
    }
});
const captureRotationHistory = () => {
    if (!rotationHistorySnapshot) rotationHistorySnapshot = captureHistorySnapshot();
};
rotationInput.addEventListener('pointerdown', captureRotationHistory);
rotationInput.addEventListener('keydown', captureRotationHistory);
rotationInput.addEventListener('input', () => {
    const state = getModeState();
    const annotation = state.annotations[state.selectedAnnotationIndex];
    if (!annotation || annotation.type !== 'rectangle') return;
    annotation.rotation = Number(rotationInput.value);
    rotationValue.value = `${annotation.rotation}°`;
    rotationValue.textContent = rotationValue.value;
    redraw();
});
rotationInput.addEventListener('change', () => {
    pushHistorySnapshot(rotationHistorySnapshot);
    rotationHistorySnapshot = null;
});
resetRotationBtn.addEventListener('click', () => {
    const state = getModeState();
    const annotation = state.annotations[state.selectedAnnotationIndex];
    if (!annotation || annotation.type !== 'rectangle') return;

    const before = captureHistorySnapshot();
    annotation.rotation = 0;
    rotationInput.value = '0';
    rotationValue.value = '0°';
    rotationValue.textContent = rotationValue.value;
    rotationHistorySnapshot = null;
    pushHistorySnapshot(before);
    redraw();
});
dashedCheckbox.addEventListener('change', () => {
    const state = getModeState();
    if (state.selectedAnnotationIndex >= 0) {
        const before = captureHistorySnapshot();
        state.annotations[state.selectedAnnotationIndex].dashed = dashedCheckbox.checked;
        pushHistorySnapshot(before);
        redraw();
    }
});
deleteBtn.addEventListener('click', deleteSelectedAnnotation);
deselectBtn.addEventListener('click', deselectAnnotation);
caseCodeInput.addEventListener('input', () => {
    localStorage.setItem('caseCode', caseCodeInput.value);
    updateFilenamePreview();
});
sourceInput.addEventListener('input', () => {
    localStorage.setItem('source', sourceInput.value);
    updateFilenamePreview();
});
chooseFolderBtn.addEventListener('click', chooseFolderLocation);
canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseup', handleMouseUp);
document.addEventListener('keydown', handleKeyDown);
canvas.addEventListener('dblclick', handleDoubleClick);
canvas.addEventListener('contextmenu', handleRightClick);

function handleImageUpload(file) {
    if (!file) return;
    console.log('File selected:', file);

    const reader = new FileReader();
    reader.onload = (event) => {
        console.log('Reader onload');
        const img = new Image();
        img.onload = () => {
            console.log('Image onload');
            originalImage = img;
            currentMode = 'ground';
            resetModeState(modes.ground);
            resetModeState(modes.satellite);
            resizeAndDisplay();
            editPanel.style.visibility = 'hidden';
            setToolButtonsEnabled(true);
            updateModeButtons();
            updateToolButtons();
            updateToolInfo();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function resizeAndDisplay() {
    if (!originalImage) return;
    console.log('Resizing image');

    const dimensions = getScaledImageDimensions(originalImage.width, originalImage.height);
    console.log('New size:', dimensions.width, dimensions.height);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = dimensions.width;
    tempCanvas.height = dimensions.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(originalImage, 0, 0, dimensions.width, dimensions.height);

    const imageData = tempCanvas.toDataURL('image/jpeg', 0.95);
    resizedImage = new Image();
    resizedImage.onload = () => {
        console.log('Resized image onload');
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        editPanel.style.visibility = 'hidden';
        redraw();
    };
    resizedImage.src = imageData;
}

function getScaledImageDimensions(width, height) {
    const scale = Math.min(TARGET_HEIGHT / height, MAX_IMAGE_WIDTH / width);
    return {
        width: Math.round(width * scale),
        height: Math.round(height * scale)
    };
}

function drawAnnotedText(rect) {
    drawRectangleLabel(ctx, rect);
}

function getRectangleCenter(rect) {
    return {
        x: (rect.start.x + rect.end.x) / 2,
        y: (rect.start.y + rect.end.y) / 2
    };
}

function rotateRectanglePoint(point, rect) {
    const angle = (rect.rotation || 0) * Math.PI / 180;
    if (!angle) return { x: point.x, y: point.y };
    const center = getRectangleCenter(rect);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
        x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle)
    };
}

function unrotateRectanglePoint(point, rect) {
    const angle = -(rect.rotation || 0) * Math.PI / 180;
    if (!angle) return { x: point.x, y: point.y };
    const center = getRectangleCenter(rect);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
        x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle)
    };
}

function getRectangleCorners(rect) {
    const left = Math.min(rect.start.x, rect.end.x);
    const right = Math.max(rect.start.x, rect.end.x);
    const top = Math.min(rect.start.y, rect.end.y);
    const bottom = Math.max(rect.start.y, rect.end.y);
    return {
        topLeft: rotateRectanglePoint({ x: left, y: top }, rect),
        topRight: rotateRectanglePoint({ x: right, y: top }, rect),
        bottomLeft: rotateRectanglePoint({ x: left, y: bottom }, rect),
        bottomRight: rotateRectanglePoint({ x: right, y: bottom }, rect)
    };
}

function getRectangleLabelBounds(rect) {
    if (!rect.label || rect.labelPosition === 'none') return null;

    const leftX = Math.min(rect.start.x, rect.end.x);
    const rightX = Math.max(rect.start.x, rect.end.x);
    const topY = Math.min(rect.start.y, rect.end.y);
    const bottomY = Math.max(rect.start.y, rect.end.y);
    const rotation = rect.rotation || 0;
    let labelPosition = rect.labelPosition || DEFAULT_RECTANGLE_LABEL_POSITION;

    if (rotation !== 0) {
        const cornerByPosition = {
            right: 'bottomRight',
            left: 'bottomLeft',
            topRight: 'topRight',
            topLeft: 'topLeft',
            cornerBR: 'bottomRight',
            cornerBL: 'bottomLeft',
            cornerTR: 'topRight',
            cornerTL: 'topLeft'
        };
        const corner = getRectangleCorners(rect)[cornerByPosition[labelPosition] || 'bottomRight'];
        const center = getRectangleCenter(rect);
        const labelOnRight = corner.x >= center.x;
        const labelOnBottom = corner.y >= center.y;
        return {
            x: labelOnRight ? corner.x : corner.x - LABEL_SIZE,
            y: labelOnBottom ? corner.y : corner.y - LABEL_SIZE
        };
    }

    const width = rightX - leftX;
    if (width < 1.5 * LABEL_SIZE) {
        if (labelPosition === 'right') labelPosition = 'cornerBR';
        if (labelPosition === 'left') labelPosition = 'cornerBL';
        if (labelPosition === 'topRight') labelPosition = 'cornerTR';
        if (labelPosition === 'topLeft') labelPosition = 'cornerTL';
    }

    if (labelPosition === 'right' || labelPosition === 'cornerBR') {
        return {
            x: labelPosition === 'cornerBR' ? rightX : rightX + STROKE_WIDTH / 2 - LABEL_SIZE,
            y: bottomY + STROKE_WIDTH / 2 + LABEL_Y_OFFSET
        };
    }
    if (labelPosition === 'left') {
        return { x: leftX - STROKE_WIDTH / 2, y: bottomY + STROKE_WIDTH / 2 + LABEL_Y_OFFSET };
    }
    if (labelPosition === 'cornerBL') {
        return { x: leftX - LABEL_SIZE, y: bottomY + STROKE_WIDTH / 2 + LABEL_Y_OFFSET };
    }
    if (labelPosition === 'topRight') {
        return { x: rightX + STROKE_WIDTH / 2 - LABEL_SIZE, y: topY - LABEL_SIZE };
    }
    if (labelPosition === 'topLeft') {
        return { x: leftX - STROKE_WIDTH / 2, y: topY - LABEL_SIZE };
    }
    if (labelPosition === 'cornerTR') {
        return { x: rightX, y: topY - LABEL_SIZE };
    }
    if (labelPosition === 'cornerTL') {
        return { x: leftX - LABEL_SIZE, y: topY - LABEL_SIZE };
    }
    return { x: rightX + STROKE_WIDTH / 2 - LABEL_SIZE, y: bottomY + STROKE_WIDTH / 2 + LABEL_Y_OFFSET };
}

function drawRectangleLabel(targetContext, rect) {
    const bounds = getRectangleLabelBounds(rect);
    if (!bounds) return;

    targetContext.fillStyle = STROKE_COLOR;
    targetContext.fillRect(bounds.x, bounds.y, LABEL_SIZE, LABEL_SIZE);
    targetContext.fillStyle = 'white';
    targetContext.font = `${LABEL_FONT_SIZE}px ${LABEL_FONT}`;
    targetContext.textAlign = 'center';
    targetContext.textBaseline = 'middle';
    targetContext.fillText(rect.label, bounds.x + LABEL_SIZE / 2, bounds.y + LABEL_SIZE / 2 + LABEL_TEXT_Y_OFFSET);
}

function drawRectangle(rect, isSelected, isHovered = false, hoverHandleName = null) {
    ctx.strokeStyle = isSelected ? '#00ff00' : STROKE_COLOR;
    ctx.lineWidth = isSelected ? STROKE_WIDTH : (isHovered ? STROKE_WIDTH * 2 : STROKE_WIDTH);
    ctx.setLineDash(rect.dashed ? DASH_PATTERN : []);

    const center = getRectangleCenter(rect);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate((rect.rotation || 0) * Math.PI / 180);
    ctx.strokeRect(rect.start.x - center.x, rect.start.y - center.y, rect.end.x - rect.start.x, rect.end.y - rect.start.y);
    ctx.restore();
    ctx.setLineDash([]);

    if (isSelected || isHovered) {
        drawSelectionHandles(rect, hoverHandleName, isHovered);
    }
}

function drawSelectionHandles(rect, hoveredHandleName = null, isHovered = false) {
    const baseSize = isHovered ? 30 * ANNOTATION_SCALE : 24 * ANNOTATION_SCALE;
    const corners = [
        { name: 'start', point: rotateRectanglePoint(rect.start, rect) },
        { name: 'end', point: rotateRectanglePoint(rect.end, rect) }
    ];

    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = SELECTION_HANDLE_LINE_WIDTH;

    corners.forEach(({ name, point }) => {
        const size = hoveredHandleName === name ? baseSize + 6 * ANNOTATION_SCALE : baseSize;
        const offset = size / 2;
        ctx.beginPath();
        ctx.rect(point.x - offset, point.y - offset, size, size);
        ctx.fill();
        ctx.stroke();
    });
}

function drawPolygonHandles(points, hoveredHandleIndex = null, isHovered = false) {
    const baseSize = isHovered ? 24 * ANNOTATION_SCALE : SELECTION_HOVER_HANDLE_SIZE;
    const half = baseSize / 2;

    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = SELECTION_HANDLE_LINE_WIDTH;

    points.forEach((point, index) => {
        const size = hoveredHandleIndex === index ? baseSize + 6 * ANNOTATION_SCALE : baseSize;
        const offset = size / 2;
        ctx.beginPath();
        ctx.rect(point.x - offset, point.y - offset, size, size);
        ctx.fill();
        ctx.stroke();
    });
}

function drawLabelHandle(label, isHovered = false) {
    const handleSize = isHovered ? SELECTION_HOVER_HANDLE_SIZE : SELECTION_HANDLE_SIZE;
    const half = handleSize / 2;

    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = SELECTION_HANDLE_LINE_WIDTH;

    ctx.beginPath();
    ctx.rect(label.x + LABEL_SIZE / 2 - half, label.y + LABEL_SIZE / 2 - half, handleSize, handleSize);
    ctx.fill();
    ctx.stroke();
}

function drawPolygon(points, isSelected, dashed = false, isHovered = false, hoveredHandleIndex = null) {
    if (points.length < 2) return;
    ctx.strokeStyle = isSelected ? '#00ff00' : STROKE_COLOR;
    ctx.lineWidth = isSelected ? STROKE_WIDTH : (isHovered ? STROKE_WIDTH * 2 : STROKE_WIDTH);
    ctx.setLineDash(dashed ? DASH_PATTERN : []);

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    if (isSelected || isHovered) {
        drawPolygonHandles(points, hoveredHandleIndex, isHovered);
    }
    ctx.setLineDash([]);
}

function drawLabel(label, showHandle = false) {
    ctx.fillStyle = showHandle ? '#00ff00' : STROKE_COLOR;
    ctx.fillRect(label.x, label.y, LABEL_SIZE, LABEL_SIZE);

    ctx.fillStyle = 'white';
    ctx.font = `${LABEL_FONT_SIZE}px ${LABEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.letter, label.x + LABEL_SIZE / 2, label.y + LABEL_SIZE / 2 + LABEL_TEXT_Y_OFFSET);

    if (showHandle) {
        drawLabelHandle(label, showHandle);
    }
}

function getExactLocationLabelBounds(annotation) {
    ctx.font = `${EXACT_LOCATION_FONT_SIZE}px ${EXACT_LOCATION_FONT}`;
    const state = getModeState();
    const isEditingLabel = state.selectedAnnotationIndex >= 0 && state.annotations[state.selectedAnnotationIndex] === annotation && annotation.type === 'exact-location';
    const displayLabel = isEditingLabel ? labelInput.value : (annotation.label ?? EXACT_LOCATION_DEFAULT_TEXT);
    const metrics = ctx.measureText(displayLabel);
    const width = metrics.width;
    const height = EXACT_LOCATION_FONT_SIZE * 1.2;
    return {
        x: annotation.x + annotation.labelOffset.x,
        y: annotation.y + annotation.labelOffset.y,
        width,
        height
    };
}

function drawExactLocation(annotation, isSelected, isHovered, hoveredHandle = null) {
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(annotation.x, annotation.y, EXACT_LOCATION_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    if (isSelected || isHovered) {
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = SELECTION_HANDLE_LINE_WIDTH;
        ctx.beginPath();
        ctx.arc(annotation.x, annotation.y, EXACT_LOCATION_RADIUS + EXACT_LOCATION_SELECTION_RING_OFFSET, 0, Math.PI * 2);
        ctx.stroke();
    }

    const labelBounds = getExactLocationLabelBounds(annotation);
    ctx.save();
    ctx.font = `${EXACT_LOCATION_FONT_SIZE}px ${EXACT_LOCATION_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = ANNOTATION_SHADOW_BLUR * 0.75;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    const state = getModeState();
    const isEditingLabel = state.selectedAnnotationIndex >= 0 && state.annotations[state.selectedAnnotationIndex] === annotation && annotation.type === 'exact-location';
    const displayLabel = isEditingLabel ? labelInput.value : (annotation.label ?? EXACT_LOCATION_DEFAULT_TEXT);
    ctx.fillText(displayLabel, labelBounds.x, labelBounds.y);
    ctx.restore();

    if (isSelected || isHovered) {
        const handleSize = hoveredHandle === 'label' ? SELECTION_HOVER_HANDLE_SIZE : SELECTION_HANDLE_SIZE;
        const offset = handleSize / 2;
        ctx.fillStyle = 'white';
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = SELECTION_HANDLE_LINE_WIDTH;
        ctx.beginPath();
        ctx.rect(annotation.x - offset, annotation.y - offset, handleSize, handleSize);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.rect(labelBounds.x - offset, labelBounds.y - offset, labelBounds.width + handleSize, labelBounds.height + handleSize);
        ctx.stroke();
    }
}

function redraw() {
    console.log('Redrawing, resizedImage:', resizedImage);
    if (!resizedImage) return;
    const state = getModeState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(resizedImage, 0, 0);

    state.annotations.forEach((annotation, index) => {
        const isSelected = index === state.selectedAnnotationIndex;
        const isHovered = index === hoverAnnotationIndex && state.currentTool === 'select';
        const handleHoverIndex = isHovered && hoverHandle && annotation.type === 'polygon' && hoverHandle.startsWith('point') ? parseInt(hoverHandle.replace('point', '')) : null;
        if (annotation.type === 'rectangle') {
            drawRectangle(annotation, isSelected, isHovered, hoverHandle);
            drawAnnotedText(annotation);
        } else if (annotation.type === 'polygon') {
            drawPolygon(annotation.points, isSelected, annotation.dashed, isHovered, handleHoverIndex);
        } else if (annotation.type === 'label') {
            drawLabel(annotation, isSelected || isHovered);
        } else if (annotation.type === 'exact-location') {
            drawExactLocation(annotation, isSelected, isHovered, hoverHandle);
        }
    });

    if (state.currentTool === 'polygon' && state.currentPath.length > 0) {
        drawPolygon(state.currentPath, false, false);
        if (state.tempPath && state.tempPath.end) {
            ctx.strokeStyle = STROKE_COLOR;
            ctx.lineWidth = STROKE_WIDTH;
            ctx.setLineDash([4 * ANNOTATION_SCALE, 2 * ANNOTATION_SCALE]);
            ctx.beginPath();
            ctx.moveTo(state.currentPath[state.currentPath.length - 1].x, state.currentPath[state.currentPath.length - 1].y);
            ctx.lineTo(state.tempPath.end.x, state.tempPath.end.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    if (state.tempPath && state.tempPath.end && state.currentTool === 'rectangle') {
        ctx.strokeStyle = STROKE_COLOR;
        ctx.lineWidth = STROKE_WIDTH;
        ctx.setLineDash(state.tempPath.dashed ? DASH_PATTERN : []);
        const width = state.tempPath.end.x - state.tempPath.start.x;
        const height = state.tempPath.end.y - state.tempPath.start.y;
        ctx.strokeRect(state.tempPath.start.x, state.tempPath.start.y, width, height);
        ctx.setLineDash([]);
    }
}

function selectTool(tool) {
    if (!resizedImage) {
        alert('Please upload an image first');
        return;
    }

    const state = getModeState();
    if (state.currentTool === tool) {
        state.currentTool = null;
    } else {
        state.currentTool = tool;
        if (tool === 'polygon') {
            state.currentPath = [];
        }
        deselectAnnotation();
    }
    updateToolButtons();
    updateToolInfo();
    redraw();
}

function updateToolButtons() {
    const state = getModeState();
    rectangleBtn.classList.toggle('active', state.currentTool === 'rectangle');
    polygonBtn.classList.toggle('active', state.currentTool === 'polygon');
    selectBtn.classList.toggle('active', state.currentTool === 'select');
    labelBtn.classList.toggle('active', state.currentTool === 'label');
    exactLocationBtn.classList.toggle('active', state.currentTool === 'exact-location');
    exactLocationBtn.style.display = currentMode === 'satellite' ? 'inline-block' : 'none';
}

function updateToolInfo() {
    const state = getModeState();
    if (!resizedImage) {
        toolInfo.textContent = 'Upload a JPEG or PNG image first to enable annotation tools.';
    } else if (state.currentTool === 'rectangle') {
        toolInfo.textContent = 'Click and drag to draw a rectangle, or click a second time to finish.';
    } else if (state.currentTool === 'polygon') {
        toolInfo.textContent = 'Click to add points. Double-click to finish polyline. Right-click to undo last point.';
    } else if (state.currentTool === 'select') {
        toolInfo.textContent = 'Click a shape to select it. Drag handles to resize, drag shape to move.';
    } else if (state.currentTool === 'label') {
        toolInfo.textContent = 'Click to place a label square.';
    } else if (state.currentTool === 'exact-location') {
        toolInfo.textContent = 'Click on the image to place an Exact Location marker.';
    } else if (state.selectedAnnotationIndex >= 0) {
        toolInfo.textContent = 'Drag a handle to resize or move the shape, or use the edit panel.';
    } else {
        const modeLabel = currentMode === 'satellite' ? 'Satellite' : 'Ground Level';
        toolInfo.textContent = `${modeLabel} Image Mode active. Click a shape to select it and see edit options.`;
    }
}

function getCanvasCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function handleMouseDown(e) {
    if (!resizedImage) return;
    const state = getModeState();
    const { x, y } = getCanvasCoordinates(e);

    if (state.currentTool === 'rectangle') {
        if (state.rectangleAnchor) {
            const endPoint = { x, y };
            if (Math.abs(endPoint.x - state.rectangleAnchor.x) > 5 && Math.abs(endPoint.y - state.rectangleAnchor.y) > 5) {
                const before = captureHistorySnapshot();
                state.annotations.push({
                    type: 'rectangle',
                    start: state.rectangleAnchor,
                    end: endPoint,
                    label: '',
                    labelPosition: DEFAULT_RECTANGLE_LABEL_POSITION,
                    dashed: DEFAULT_ANNOTATION_DASHED
                });
                pushHistorySnapshot(before);
                selectAnnotation(state.annotations.length - 1);
                labelInput.focus({ preventScroll: true });
            }
            state.rectangleAnchor = null;
            state.tempPath = null;
            redraw();
        } else {
            state.rectangleAnchor = { x, y };
            isDrawing = false;
            state.tempPath = { start: state.rectangleAnchor, end: state.rectangleAnchor, dashed: DEFAULT_ANNOTATION_DASHED };
            redraw();
        }
    } else if (state.currentTool === 'polygon') {
        state.currentPath.push({ x, y });
        redraw();
    } else if (state.currentTool === 'label') {
        const before = captureHistorySnapshot();
        state.annotations.push({
            type: 'label',
            x: x - LABEL_SIZE / 2,
            y: y - LABEL_SIZE / 2,
            letter: ''
        });
        pushHistorySnapshot(before);
        selectAnnotation(state.annotations.length - 1);
        labelInput.focus({ preventScroll: true });
        redraw();
    } else if (state.currentTool === 'exact-location') {
        const annotation = {
            type: 'exact-location',
            x,
            y,
            label: EXACT_LOCATION_DEFAULT_TEXT,
            labelOffset: { ...EXACT_LOCATION_LABEL_OFFSET }
        };
        const before = captureHistorySnapshot();
        state.annotations.push(annotation);
        pushHistorySnapshot(before);
        selectAnnotation(state.annotations.length - 1);
        labelInput.focus({ preventScroll: true });
        redraw();
    } else if (state.currentTool === 'select' || !state.currentTool) {
        const clickedIndex = findAnnotationAtPoint({ x, y });
        if (clickedIndex >= 0) {
            selectAnnotation(clickedIndex);
            const annotation = state.annotations[clickedIndex];
            const handle = getHandleNearPoint({ x, y }, annotation);
            if (handle) {
                dragHistorySnapshot = captureHistorySnapshot();
                state.selectedHandle = handle;
                state.dragStart = { x, y, annotation: JSON.parse(JSON.stringify(annotation)) };
            } else {
                dragHistorySnapshot = captureHistorySnapshot();
                state.dragStart = { x, y, annotation: JSON.parse(JSON.stringify(annotation)) };
            }
        } else {
            deselectAnnotation();
        }
    }
}

function handleMouseMove(e) {
    if (!resizedImage) return;
    const state = getModeState();
    const { x, y } = getCanvasCoordinates(e);

    if (state.currentTool === 'select') {
        const hover = getHoverState({ x, y });
        hoverAnnotationIndex = hover.index;
        hoverHandle = hover.handle;
        canvas.style.cursor = hover.index >= 0 ? 'pointer' : 'default';
        redraw();
    } else if (hoverAnnotationIndex !== -1) {
        hoverAnnotationIndex = -1;
        hoverHandle = null;
        canvas.style.cursor = 'default';
        redraw();
    }

    if (state.currentTool === 'rectangle' && state.rectangleAnchor) {
        if (Math.abs(x - state.rectangleAnchor.x) > 2 || Math.abs(y - state.rectangleAnchor.y) > 2) {
            isDrawing = true;
        }
        state.tempPath = { start: state.rectangleAnchor, end: { x, y }, dashed: DEFAULT_ANNOTATION_DASHED };
        redraw();
    } else if (state.currentTool === 'polygon' && state.currentPath.length > 0) {
        state.tempPath = { end: { x, y } };
        redraw();
    } else if (state.selectedAnnotationIndex >= 0) {
        const annotation = state.annotations[state.selectedAnnotationIndex];
        if (state.selectedHandle) {
            if (annotation.type === 'rectangle') {
                const original = state.dragStart ? state.dragStart.annotation : annotation;
                const fixedName = state.selectedHandle === 'start' ? 'end' : 'start';
                const fixedPoint = original[fixedName];
                const fixedScreenPoint = rotateRectanglePoint(fixedPoint, original);
                const center = { x: (x + fixedScreenPoint.x) / 2, y: (y + fixedScreenPoint.y) / 2 };
                const halfDx = (x - fixedScreenPoint.x) / 2;
                const halfDy = (y - fixedScreenPoint.y) / 2;
                const angle = (original.rotation || 0) * Math.PI / 180;
                const halfWidth = halfDx * Math.cos(angle) + halfDy * Math.sin(angle);
                const halfHeight = -halfDx * Math.sin(angle) + halfDy * Math.cos(angle);
                const positivePoint = { x: center.x + halfWidth, y: center.y + halfHeight };
                const negativePoint = { x: center.x - halfWidth, y: center.y - halfHeight };
                if (state.selectedHandle === 'start') {
                    annotation.start = positivePoint;
                    annotation.end = negativePoint;
                } else {
                    annotation.start = negativePoint;
                    annotation.end = positivePoint;
                }
            } else if (annotation.type === 'polygon') {
                const index = parseInt(state.selectedHandle.replace('point', ''));
                annotation.points[index] = { x, y };
            } else if (annotation.type === 'label') {
                annotation.x = x - LABEL_SIZE / 2;
                annotation.y = y - LABEL_SIZE / 2;
            } else if (annotation.type === 'exact-location') {
                if (state.selectedHandle === 'marker') {
                    annotation.x = x;
                    annotation.y = y;
                } else if (state.selectedHandle === 'label') {
                    annotation.labelOffset = { x: x - annotation.x, y: y - annotation.y };
                }
            }
            redraw();
        } else if (state.dragStart) {
            const dx = x - state.dragStart.x;
            const dy = y - state.dragStart.y;
            if (annotation.type === 'rectangle') {
                annotation.start = { x: state.dragStart.annotation.start.x + dx, y: state.dragStart.annotation.start.y + dy };
                annotation.end = { x: state.dragStart.annotation.end.x + dx, y: state.dragStart.annotation.end.y + dy };
            } else if (annotation.type === 'polygon') {
                annotation.points = state.dragStart.annotation.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
            } else if (annotation.type === 'label') {
                annotation.x = state.dragStart.annotation.x + dx;
                annotation.y = state.dragStart.annotation.y + dy;
            } else if (annotation.type === 'exact-location') {
                annotation.x = state.dragStart.annotation.x + dx;
                annotation.y = state.dragStart.annotation.y + dy;
            }
            redraw();
        }
    }
}

function handleMouseUp(e) {
    if (!resizedImage) return;
    const state = getModeState();
    if (state.currentTool === 'rectangle' && state.rectangleAnchor && isDrawing) {
        const { x, y } = getCanvasCoordinates(e);
        const endPoint = { x, y };
        if (Math.abs(endPoint.x - state.rectangleAnchor.x) > 5 && Math.abs(endPoint.y - state.rectangleAnchor.y) > 5) {
            const before = captureHistorySnapshot();
            state.annotations.push({
                type: 'rectangle',
                start: state.rectangleAnchor,
                end: endPoint,
                label: '',
                labelPosition: DEFAULT_RECTANGLE_LABEL_POSITION,
                dashed: DEFAULT_ANNOTATION_DASHED
            });
            pushHistorySnapshot(before);
            selectAnnotation(state.annotations.length - 1);
            labelInput.focus({ preventScroll: true });
        }
        state.rectangleAnchor = null;
        isDrawing = false;
        state.tempPath = null;
        redraw();
    }
    if (dragHistorySnapshot) {
        pushHistorySnapshot(dragHistorySnapshot);
        dragHistorySnapshot = null;
    }
    state.selectedHandle = null;
    state.dragStart = null;
}

function handleDoubleClick(e) {
    const state = getModeState();
    if (state.currentTool !== 'polygon' || state.currentPath.length < 3) return;
    e.preventDefault();
    const before = captureHistorySnapshot();
    state.annotations.push({
        type: 'polygon',
        points: [...state.currentPath],
        dashed: DEFAULT_ANNOTATION_DASHED
    });
    pushHistorySnapshot(before);
    state.currentPath = [];
    state.tempPath = null;
    redraw();
}

function handleRightClick(e) {
    const state = getModeState();
    e.preventDefault();
    if (state.currentTool === 'polygon' && state.currentPath.length > 0) {
        const before = captureHistorySnapshot();
        state.currentPath.pop();
        redoStack.length = 0;
        historyStack.push(before);
        redraw();
    }
}

function findAnnotationAtPoint(point) {
    const state = getModeState();
    for (let i = state.annotations.length - 1; i >= 0; i--) {
        const annotation = state.annotations[i];
        if (annotation.type === 'rectangle' && isPointInsideRect(point, annotation)) {
            return i;
        } else if (annotation.type === 'polygon' &&
                   (isPointInsidePolygon(point, annotation.points) || isPointNearPolyline(point, annotation.points))) {
            return i;
        } else if (annotation.type === 'label' && isPointInsideLabel(point, annotation)) {
            return i;
        } else if (annotation.type === 'exact-location' && isPointInsideExactLocation(point, annotation)) {
            return i;
        }
    }
    return -1;
}

function isPointInsidePolygon(point, points) {
    if (points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        if (((points[i].y > point.y) !== (points[j].y > point.y)) &&
            (point.x < (points[j].x - points[i].x) * (point.y - points[i].y) / (points[j].y - points[i].y) + points[i].x)) {
            inside = !inside;
        }
    }
    return inside;
}

function isPointInsideLabel(point, label) {
    return point.x >= label.x && point.x <= label.x + LABEL_SIZE &&
           point.y >= label.y && point.y <= label.y + LABEL_SIZE;
}

function isPointInsideExactLocation(point, annotation) {
    const dx = point.x - annotation.x;
    const dy = point.y - annotation.y;
    const radiusThreshold = EXACT_LOCATION_RADIUS + EXACT_LOCATION_HIT_PADDING;
    if (Math.sqrt(dx * dx + dy * dy) <= radiusThreshold) {
        return true;
    }
    const bounds = getExactLocationLabelBounds(annotation);
    return point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
           point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function isPointInsideRect(point, rect) {
    const localPoint = unrotateRectanglePoint(point, rect);
    const left = Math.min(rect.start.x, rect.end.x) - STROKE_WIDTH / 2;
    const right = Math.max(rect.start.x, rect.end.x) + STROKE_WIDTH / 2;
    const top = Math.min(rect.start.y, rect.end.y) - STROKE_WIDTH / 2;
    const bottom = Math.max(rect.start.y, rect.end.y) + STROKE_WIDTH / 2;
    return localPoint.x >= left && localPoint.x <= right &&
           localPoint.y >= top && localPoint.y <= bottom;
}

function getPolygonHandleIndex(point, points) {
    const threshold = POLYLINE_VERTEX_HIT_THRESHOLD;
    let nearestIndex = -1;
    let nearestDistance = threshold;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const dx = point.x - p.x;
        const dy = point.y - p.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= nearestDistance) {
            nearestIndex = i;
            nearestDistance = distance;
        }
    }
    return nearestIndex;
}

function isPointNearPolyline(point, points) {
    if (points.length === 0) return false;
    if (points.length === 1) {
        const dx = point.x - points[0].x;
        const dy = point.y - points[0].y;
        return Math.hypot(dx, dy) <= POLYLINE_VERTEX_HIT_THRESHOLD;
    }

    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const projection = lengthSquared === 0
            ? 0
            : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
        const nearestX = start.x + projection * dx;
        const nearestY = start.y + projection * dy;
        if (Math.hypot(point.x - nearestX, point.y - nearestY) <= POLYLINE_HIT_THRESHOLD) {
            return true;
        }
    }
    return false;
}

function getHandleNearPoint(point, annotation) {
    const threshold = HANDLE_HIT_THRESHOLD;
    if (annotation.type === 'rectangle') {
        const corners = ['start', 'end'];
        let nearestCorner = null;
        let nearestDistance = POLYLINE_VERTEX_HIT_THRESHOLD;
        for (const corner of corners) {
            const p = rotateRectanglePoint(annotation[corner], annotation);
            const dx = point.x - p.x;
            const dy = point.y - p.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= nearestDistance) {
                nearestCorner = corner;
                nearestDistance = distance;
            }
        }
        return nearestCorner;
    } else if (annotation.type === 'polygon') {
        const index = getPolygonHandleIndex(point, annotation.points);
        return index >= 0 ? `point${index}` : null;
    } else if (annotation.type === 'label') {
        const labelCenter = { x: annotation.x + LABEL_SIZE / 2, y: annotation.y + LABEL_SIZE / 2 };
        const dx = point.x - labelCenter.x;
        const dy = point.y - labelCenter.y;
        return Math.sqrt(dx * dx + dy * dy) <= threshold ? 'label' : null;
    } else if (annotation.type === 'exact-location') {
        const dx = point.x - annotation.x;
        const dy = point.y - annotation.y;
        const markerThreshold = Math.max(threshold, EXACT_LOCATION_RADIUS + EXACT_LOCATION_HIT_PADDING);
        if (Math.sqrt(dx * dx + dy * dy) <= markerThreshold) {
            return 'marker';
        }
        const bounds = getExactLocationLabelBounds(annotation);
        if (point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
            point.y >= bounds.y && point.y <= bounds.y + bounds.height) {
            return 'label';
        }
    }
    return null;
}

function getHoverState(point) {
    const state = getModeState();
    for (let i = state.annotations.length - 1; i >= 0; i--) {
        const annotation = state.annotations[i];
        const handle = getHandleNearPoint(point, annotation);
        if (handle) {
            return { index: i, handle };
        }
        if (annotation.type === 'rectangle' && isPointInsideRect(point, annotation)) {
            return { index: i, handle: null };
        }
        if (annotation.type === 'polygon' && isPointInsidePolygon(point, annotation.points)) {
            return { index: i, handle: null };
        }
        if (annotation.type === 'label' && isPointInsideLabel(point, annotation)) {
            return { index: i, handle: null };
        }
        if (annotation.type === 'exact-location' && isPointInsideExactLocation(point, annotation)) {
            return { index: i, handle: null };
        }
    }
    return { index: -1, handle: null };
}

function deleteSelectedAnnotation() {
    const state = getModeState();
    if (state.selectedAnnotationIndex >= 0) {
        const before = captureHistorySnapshot();
        state.annotations.splice(state.selectedAnnotationIndex, 1);
        pushHistorySnapshot(before);
        deselectAnnotation();
        redraw();
    }
}

function clearAnnotations() {
    const state = getModeState();
    if (!confirm('Are you sure you want to clear all annotations?')) return;
    const before = captureHistorySnapshot();
    state.annotations = [];
    state.currentPath = [];
    state.tempPath = null;
    state.rectangleAnchor = null;
    state.selectedAnnotationIndex = -1;
    editPanel.style.visibility = 'hidden';
    labelInput.value = '';
    pushHistorySnapshot(before);
    redraw();
}

function selectAnnotation(index) {
    const state = getModeState();
    state.selectedAnnotationIndex = index;
    const annotation = state.annotations[index];
    editPanel.style.visibility = 'visible';
    labelInput.placeholder = 'A-Z';

    if (annotation.type === 'rectangle') {
        labelTextGroup.style.visibility = 'visible';
        labelSideGroup.style.visibility = 'visible';
        dashedGroup.style.visibility = 'visible';
        rotationGroup.style.visibility = currentMode === 'satellite' ? 'visible' : 'hidden';
        labelInput.value = annotation.label || '';
        labelSideSelect.value = annotation.labelPosition || DEFAULT_RECTANGLE_LABEL_POSITION;
        dashedCheckbox.checked = Boolean(annotation.dashed);
        rotationInput.value = String(annotation.rotation || 0);
        rotationValue.value = `${annotation.rotation || 0}°`;
        rotationValue.textContent = rotationValue.value;
    } else if (annotation.type === 'polygon') {
        labelTextGroup.style.visibility = 'hidden';
        labelSideGroup.style.visibility = 'hidden';
        dashedGroup.style.visibility = 'visible';
        rotationGroup.style.visibility = 'hidden';
        labelInput.value = '';
        dashedCheckbox.checked = Boolean(annotation.dashed);
    } else if (annotation.type === 'label') {
        labelTextGroup.style.visibility = 'visible';
        labelSideGroup.style.visibility = 'hidden';
        dashedGroup.style.visibility = 'hidden';
        rotationGroup.style.visibility = 'hidden';
        labelInput.value = annotation.letter || '';
    } else if (annotation.type === 'exact-location') {
        labelTextGroup.style.visibility = 'visible';
        labelSideGroup.style.visibility = 'hidden';
        dashedGroup.style.visibility = 'hidden';
        rotationGroup.style.visibility = 'hidden';
        labelInput.value = annotation.label || '';
        labelInput.placeholder = 'Edit text';
    }

    state.currentTool = null;
    state.selectedHandle = null;
    state.dragStart = null;
    state.rectangleAnchor = null;
    updateToolButtons();
    updateToolInfo();
    updateFilenamePreview();
    redraw();
}

function deselectAnnotation() {
    const state = getModeState();
    state.selectedAnnotationIndex = -1;
    state.selectedHandle = null;
    state.dragStart = null;
    state.rectangleAnchor = null;
    isDrawing = false;
    state.tempPath = null;
    editPanel.style.visibility = 'hidden';
    rotationGroup.style.visibility = 'hidden';
    updateToolInfo();
    updateFilenamePreview();
    redraw();
}

function handleLabelInputRealtime() {
    redraw();
}

function handleLabelInput() {
    const text = labelInput.value.trim();
    const state = getModeState();
    if (state.selectedAnnotationIndex >= 0) {
        const before = captureHistorySnapshot();
        const annotation = state.annotations[state.selectedAnnotationIndex];
        if (annotation.type === 'rectangle') {
            if (/^[A-Z]$/.test(text.toUpperCase())) {
                annotation.label = text.toUpperCase();
            }
        } else if (annotation.type === 'label') {
            if (/^[A-Z]$/.test(text.toUpperCase())) {
                annotation.letter = text.toUpperCase();
            }
        } else if (annotation.type === 'exact-location') {
            annotation.label = text;
        }
        pushHistorySnapshot(before);
        labelInput.value = '';
        updateFilenamePreview();
        redraw();
    }
}

function buildFilename(caseCode, source, annotations) {
    const normalizedCaseCode = caseCode.trim() || 'case';
    const normalizedSource = source.trim() || 'source';
    const labels = [];
    annotations.forEach(annotation => {
        if (annotation.type === 'rectangle' && annotation.label) {
            labels.push(annotation.label);
        } else if (annotation.type === 'label' && annotation.letter) {
            labels.push(annotation.letter);
        }
    });
    labels.sort();
    const suffix = labels.join('');
    if (suffix) {
        return `${normalizedCaseCode}_${suffix}_${normalizedSource}.jpg`;
    }
    return `${normalizedCaseCode}_${normalizedSource}.jpg`;
}

function updateFilenamePreview() {
    const state = getModeState();
    filenamePreview.textContent = `Filename: ${buildFilename(caseCodeInput.value, sourceInput.value, state.annotations)}`;
}

async function chooseFolderLocation() {
    try {
        selectedFolderHandle = await window.showDirectoryPicker();
        folderPathDisplay.value = selectedFolderHandle.name || 'Selected Folder';
        await saveFolderHandleToDB(selectedFolderHandle);
    } catch (err) {
        if (err.name !== 'AbortError') {
            alert('Error selecting folder: ' + err.message);
        }
    }
}

async function chooseImageFile() {
    await chooseFile(imageUpload, [{
        description: 'Images',
        accept: {
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png']
        }
    }]);
}

async function chooseProjectFile() {
    await chooseFile(fileUpload, [{
        description: 'Airwars Evidence files',
        accept: {
            'application/zip': ['.awe']
        }
    }]);
}

async function chooseFile(input, types) {
    if (typeof window.showOpenFilePicker !== 'function') {
        input.click();
        return;
    }

    try {
        const options = { types };
        if (selectedFolderHandle) {
            options.startIn = selectedFolderHandle;
        }
        const [fileHandle] = await window.showOpenFilePicker(options);
        const file = await fileHandle.getFile();

        if (input === imageUpload) {
            handleImageUpload(file);
        } else {
            await handleFileUpload(file);
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            alert('Error selecting file: ' + err.message);
        }
    }
}

async function restoreFolderHandle() {
    try {
        const handle = await loadFolderHandleFromDB();
        if (handle) {
            selectedFolderHandle = handle;
            folderPathDisplay.value = handle.name || 'Selected Folder';
        }
    } catch (err) {
        console.log('Could not restore folder handle');
    }
}

function downloadImage() {
    if (!resizedImage) {
        alert('Please upload an image first');
        return;
    }

    const downloadCanvas = document.createElement('canvas');
    downloadCanvas.width = canvas.width;
    downloadCanvas.height = canvas.height;
    const downloadCtx = downloadCanvas.getContext('2d');

    downloadCtx.drawImage(resizedImage, 0, 0);
    const state = getModeState();

    state.annotations.forEach(annotation => {
        if (annotation.type === 'rectangle') {
            downloadCtx.strokeStyle = STROKE_COLOR;
            downloadCtx.lineWidth = STROKE_WIDTH;
            downloadCtx.setLineDash(annotation.dashed ? DASH_PATTERN : []);
            const center = getRectangleCenter(annotation);
            downloadCtx.save();
            downloadCtx.translate(center.x, center.y);
            downloadCtx.rotate((annotation.rotation || 0) * Math.PI / 180);
            downloadCtx.strokeRect(
                annotation.start.x - center.x,
                annotation.start.y - center.y,
                annotation.end.x - annotation.start.x,
                annotation.end.y - annotation.start.y
            );
            downloadCtx.restore();
            downloadCtx.setLineDash([]);
            drawRectangleLabel(downloadCtx, annotation);
        } else if (annotation.type === 'polygon') {
            if (annotation.points.length < 2) return;
            downloadCtx.strokeStyle = STROKE_COLOR;
            downloadCtx.lineWidth = STROKE_WIDTH;
            downloadCtx.setLineDash(annotation.dashed ? DASH_PATTERN : []);
            downloadCtx.beginPath();
            downloadCtx.moveTo(annotation.points[0].x, annotation.points[0].y);
            for (let i = 1; i < annotation.points.length; i++) {
                downloadCtx.lineTo(annotation.points[i].x, annotation.points[i].y);
            }
            downloadCtx.stroke();
            downloadCtx.setLineDash([]);
        } else if (annotation.type === 'label') {
            downloadCtx.fillStyle = STROKE_COLOR;
            downloadCtx.fillRect(annotation.x, annotation.y, LABEL_SIZE, LABEL_SIZE);
            downloadCtx.fillStyle = 'white';
            downloadCtx.font = `${LABEL_FONT_SIZE}px ${LABEL_FONT}`;
            downloadCtx.textAlign = 'center';
            downloadCtx.textBaseline = 'middle';
            downloadCtx.fillText(annotation.letter, annotation.x + LABEL_SIZE / 2, annotation.y + LABEL_SIZE / 2 + LABEL_TEXT_Y_OFFSET);
        } else if (annotation.type === 'exact-location') {
            downloadCtx.fillStyle = '#ff0000';
            downloadCtx.beginPath();
            downloadCtx.arc(annotation.x, annotation.y, EXACT_LOCATION_RADIUS, 0, Math.PI * 2);
            downloadCtx.fill();
            downloadCtx.save();
            downloadCtx.fillStyle = 'white';
            downloadCtx.font = `${EXACT_LOCATION_FONT_SIZE}px ${EXACT_LOCATION_FONT}`;
            downloadCtx.textAlign = 'left';
            downloadCtx.textBaseline = 'top';
            downloadCtx.shadowColor = 'rgba(0, 0, 0, 0.65)';
            downloadCtx.shadowBlur = ANNOTATION_SHADOW_BLUR * 0.75;
            downloadCtx.shadowOffsetX = 0;
            downloadCtx.shadowOffsetY = 0;
            downloadCtx.fillText(annotation.label ?? EXACT_LOCATION_DEFAULT_TEXT, annotation.x + annotation.labelOffset.x, annotation.y + annotation.labelOffset.y);
            downloadCtx.restore();
        }
    });

    downloadCanvas.toBlob(async (blob) => {
        const url = URL.createObjectURL(blob);
        const filename = buildFilename(caseCodeInput.value, sourceInput.value, state.annotations);

        if (selectedFolderHandle) {
            try {
                const fileHandle = await selectedFolderHandle.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                alert(`File saved to: ${filename}`);
            } catch (err) {
                alert('Error saving to folder: ' + err.message);
                downloadToDefault();
            }
        } else {
            downloadToDefault();
        }
        URL.revokeObjectURL(url);

        function downloadToDefault() {
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }, 'image/jpeg', 0.95);
}

function handleKeyDown(e) {
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey;
    const shift = e.shiftKey;

    if (ctrl && key === 'z') {
        e.preventDefault();
        if (shift) redo();
        else undo();
        return;
    }

    // Don't handle other shortcuts when typing in inputs
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
    }

    if (ctrl && key === 's') {
        e.preventDefault();
        downloadImage();
    } else if (shift && key === 's') {
        e.preventDefault();
        downloadEditFile();
    } else if (shift && key === 'n') {
        e.preventDefault();
        chooseProjectFile();
    } else if (key === 'n') {
        e.preventDefault();
        chooseImageFile();
    } else if (!ctrl && !shift) {
        // Tool shortcuts
        switch (key) {
            case 'r':
                e.preventDefault();
                selectTool('rectangle');
                break;
            case 'p':
                e.preventDefault();
                selectTool('polygon');
                break;
            case 's':
                e.preventDefault();
                selectTool('select');
                break;
            case 'l':
                e.preventDefault();
                selectTool('label');
                break;
            case 'e':
                e.preventDefault();
                selectTool('exact-location');
                break;
        }
    }
}

async function downloadEditFile() {
    if (!originalImage) {
        alert('Please upload an image first');
        return;
    }

    // Create project data
    const projectData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        caseCode: caseCodeInput.value,
        source: sourceInput.value,
        currentMode: currentMode,
        exactLocationGlowEnabled: exactLocationGlowEnabled,
        modes: {
            satellite: {
                annotations: modes.satellite.annotations
            },
            ground: {
                annotations: modes.ground.annotations
            }
        }
    };

    // Convert original image to blob
    const imageBlob = await new Promise(resolve => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = originalImage.width;
        canvas.height = originalImage.height;
        ctx.drawImage(originalImage, 0, 0);
        canvas.toBlob(resolve, 'image/jpeg', 0.95);
    });

    // Create ZIP file
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(projectData, null, 2));
    zip.file('image.jpg', imageBlob);

    // Generate and download ZIP
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const state = getModeState();
    const filename = buildFilename(caseCodeInput.value, sourceInput.value, state.annotations)
        .replace(/\.jpg$/, '.awe');

    if (selectedFolderHandle) {
        try {
            const fileHandle = await selectedFolderHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(zipBlob);
            await writable.close();
            alert(`Edit file saved to: ${filename}`);
        } catch (err) {
            alert('Error saving to folder: ' + err.message);
            downloadBlob(zipBlob, filename);
        }
    } else {
        downloadBlob(zipBlob, filename);
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function handleFileUpload(file) {
    if (!file) return;

    try {
        const zip = await JSZip.loadAsync(file);
        
        // Load project data
        const projectJson = await zip.file('project.json').async('string');
        const projectData = JSON.parse(projectJson);
        
        // Load image
        const imageBlob = await zip.file('image.jpg').async('blob');
        const imageUrl = URL.createObjectURL(imageBlob);
        
        // Create image element
        const img = new Image();
        img.onload = () => {
            // Store original image
            originalImage = img;
            
            // Resize for canvas
            const dimensions = getScaledImageDimensions(img.width, img.height);
            canvas.width = dimensions.width;
            canvas.height = dimensions.height;
            
            const resizeCanvas = document.createElement('canvas');
            resizeCanvas.width = canvas.width;
            resizeCanvas.height = canvas.height;
            const resizeCtx = resizeCanvas.getContext('2d');
            resizeCtx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            resizedImage = new Image();
            resizedImage.onload = () => {
                // Restore project state
                currentMode = projectData.currentMode || 'ground';
                exactLocationGlowEnabled = projectData.exactLocationGlowEnabled !== false;
                
                if (projectData.caseCode) caseCodeInput.value = projectData.caseCode;
                if (projectData.source) sourceInput.value = projectData.source;
                
                updateFilenamePreview();
                
                // Restore annotations
                modes.satellite.annotations = projectData.modes?.satellite?.annotations || [];
                modes.ground.annotations = projectData.modes?.ground?.annotations || [];
                
                // Reset mode state
                const state = getModeState();
                state.currentTool = null;
                state.selectedAnnotationIndex = -1;
                state.selectedHandle = null;
                state.dragStart = null;
                state.rectangleAnchor = null;
                state.currentPath = [];
                state.tempPath = null;
                hoverAnnotationIndex = -1;
                hoverHandle = null;
                
                // Update UI
                updateModeButtons();
                updateToolButtons();
                updateToolInfo();
                updateFilenamePreview();
                setToolButtonsEnabled(true);
                
                // Redraw
                redraw();
                
                URL.revokeObjectURL(imageUrl);
            };
            resizedImage.src = resizeCanvas.toDataURL('image/jpeg', 0.95);
        };
        img.src = imageUrl;
        
    } catch (err) {
        alert('Error loading file: ' + err.message);
        console.error(err);
    }
}

function loadStoredValues() {
    const storedCaseCode = localStorage.getItem('caseCode');
    const storedSource = localStorage.getItem('source');
    if (storedCaseCode) caseCodeInput.value = storedCaseCode;
    if (storedSource) sourceInput.value = storedSource;
    updateFilenamePreview();
}

setToolButtonsEnabled(false);
updateToolInfo();
loadStoredValues();
restoreFolderHandle();
