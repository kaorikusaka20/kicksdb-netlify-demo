// COURTS Sneaker Catalog App - StockX Integration
// Muestra todas las tallas, pero solo habilita las disponibles

// Product Configuration
const PRODUCTS = [
    {
        name: 'Anta Kai 1 Jelly',
        sku: '112441113-13/1124D1113-13'
    },
    {
        name: 'Anta Kai 2 Triple Black',  
        sku: '112531111S-3/8125C1111S-3/812531111S-3'
    },
    {
        name: 'Anta Kai Hélà White',
        sku: '112511810S-1/1125A1810S-1/8125A1810S-1/112541810SF-1'
    }
];

// Global State
let __PRODUCT_CACHE = {};
let __CURRENCY = 'USD';
let __SELECTED_PRODUCT_SKU = null;
let __SELECTED_SIZE = null;

// Exchange Rates
const EXCHANGE = {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 148.0,
    CNY: 7.25,
    PEN: 3.72
};

// Currency Symbols
const CURRENCY_SYMBOLS = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CNY: '¥',
    PEN: 'S/'
};

// DOM Elements
const elements = {
    homeView: document.getElementById('view-home'),
    detailView: document.getElementById('view-detail'),
    currencySelect: document.getElementById('currency-select'),
    refreshBtn: document.getElementById('refresh-btn'),
    backBtn: document.getElementById('back-btn'),
    homeBtn: document.getElementById('home-btn'),
    homeNavBtn: document.getElementById('home-nav-btn'),
    productGrid: document.getElementById('product-grid'),
    detailImage: document.getElementById('detail-image'),
    detailTitle: document.getElementById('detail-title'),
    detailPrice: document.getElementById('detail-price'),
    sizesContainer: document.getElementById('sizes-container'),
    quantityInput: document.getElementById('quantity-input'),
    addToCartBtn: document.getElementById('add-to-cart-btn'),
    lastUpdatedTime: document.getElementById('last-updated-time'),
    productSku: document.getElementById('product-sku'),
    imageBadge: document.getElementById('image-badge'),
    status: document.getElementById('status'),
    loadingOverlay: document.getElementById('loading-overlay'),
    toastContainer: document.getElementById('toast-container')
};

// Utility Functions
function formatPrice(price, currency = __CURRENCY) {
    if (price === 0 || price === null || price === undefined) return 'No disponible';
    
    const convertedPrice = price * EXCHANGE[currency];
    const symbol = CURRENCY_SYMBOLS[currency];
    
    if (currency === 'JPY' || currency === 'CNY') {
        return `${symbol}${Math.round(convertedPrice).toLocaleString()}`;
    }
    
    return `${symbol}${convertedPrice.toFixed(2)}`;
}

function formatDateTime(dateString) {
    try {
        return new Date(dateString).toLocaleString('es-ES', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return 'Fecha desconocida';
    }
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => elements.toastContainer.removeChild(toast), 300);
    }, 3000);
}

function showStatus(message, type = 'loading') {
    const statusEl = elements.status;
    const messageEl = statusEl.querySelector('.status-message');
    
    messageEl.textContent = message;
    statusEl.className = `status-container ${type}`;
    statusEl.style.display = 'block';
}

function hideStatus() {
    elements.status.style.display = 'none';
}

function showLoading(show = true) {
    elements.loadingOverlay.style.display = show ? 'flex' : 'none';
}

// API Functions
async function fetchProductData(sku) {
    try {
        const response = await fetch(`/.netlify/functions/kicksdb?sku=${encodeURIComponent(sku)}&market=US`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`✅ Datos recibidos para: ${data.title}`);
        return data;
    } catch (error) {
        console.error(`Error fetching product ${sku}:`, error);
        throw error;
    }
}

async function loadAllProducts() {
    showLoading(true);
    showStatus('Conectando con StockX API...', 'loading');
    
    const loadPromises = PRODUCTS.map(async product => {
        try {
            const data = await fetchProductData(product.sku);
            __PRODUCT_CACHE[product.sku] = data;
            console.log(`✅ ${product.name}: ${data._source || 'Datos cargados'}`);
            
        } catch (error) {
            console.error(`Failed to load ${product.name}:`, error);
            __PRODUCT_CACHE[product.sku] = createEnhancedFallback(product);
            showToast(`Error cargando ${product.name} - Usando datos de respaldo`, 'warning');
        }
    });
    
    await Promise.all(loadPromises);
    hideStatus();
    showLoading(false);
    renderCatalog();
}

function createEnhancedFallback(product) {
    const officialPrices = {
        'Anta Kai 1 Jelly': 118.00,
        'Anta Kai 2 Triple Black': 101.00,
        'Anta Kai Hélà White': 80.00
    };
    
    const basePrice = officialPrices[product.name] || 120.00;
    
    return {
        sku: product.sku,
        title: product.name,
        image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=700&h=500&fit=crop',
        lastUpdated: new Date().toISOString(),
        regularPrice: basePrice,
        sizes: generateAllSizesForProduct(basePrice),
        _fallback: true,
        _message: 'Datos de respaldo - StockX'
    };
}

function generateAllSizesForProduct(basePrice) {
    const allSizes = [];
    const sizeRange = ['6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '13.5', '14', '15'];
    
    sizeRange.forEach(size => {
        const available = Math.random() > 0.4;
        const priceVariation = (Math.random() * 30) - 15;
        const price = available ? basePrice + priceVariation : 0;
        
        allSizes.push({
            size: `US ${size}`,
            price: parseFloat(price.toFixed(2)),
            available: available
        });
    });
    
    return allSizes;
}

async function refreshProducts() {
    const refreshIcon = elements.refreshBtn.querySelector('.refresh-icon');
    refreshIcon.classList.add('spinning');
    
    try {
        await loadAllProducts();
        
        if (__SELECTED_PRODUCT_SKU) {
            renderProductDetail(__SELECTED_PRODUCT_SKU);
        }
        
        showToast('Datos de StockX actualizados', 'success');
    } catch (error) {
        showToast('Error al actualizar datos', 'error');
    } finally {
        refreshIcon.classList.remove('spinning');
    }
}

// Render Functions
function renderCatalog() {
    const grid = elements.productGrid;
    grid.innerHTML = '';
    
    PRODUCTS.forEach(product => {
        const data = __PRODUCT_CACHE[product.sku];
        if (!data) return;

        const displayPrice = data.regularPrice;
        const availableSizes = data.sizes.filter(s => s.available).length;

        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <div class="product-image-container">
                <img src="${data.image}" 
                     alt="${data.title}" 
                     class="product-image"
                     onerror="this.src='https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=700&h=500&fit=crop'">
                ${data._fallback ? '<div class="fallback-badge">Demo</div>' : ''}
            </div>
            <div class="product-info">
                <h3 class="product-name">${data.title}</h3>
                <div class="product-price">
                    <span class="price-amount">${formatPrice(displayPrice)}</span>
                    <span class="available-sizes">${availableSizes} tallas disponibles</span>
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => goDetail(product.sku));
        grid.appendChild(card);
    });
}

function renderProductDetail(sku) {
    const data = __PRODUCT_CACHE[sku];
    if (!data) {
        goHome();
        return;
    }
    
    __SELECTED_PRODUCT_SKU = sku;
    __SELECTED_SIZE = null;
    
    // Actualizar información del producto
    elements.detailImage.src = data.image;
    elements.detailImage.alt = data.title;
    elements.detailTitle.textContent = data.title;
    elements.lastUpdatedTime.textContent = formatDateTime(data.lastUpdated);
    elements.productSku.textContent = data.sku;
    
    if (data._fallback) {
        elements.imageBadge.style.display = 'block';
        elements.imageBadge.querySelector('.badge-text').textContent = 'Modo Demo';
    } else {
        elements.imageBadge.style.display = 'none';
    }
    
    // CORRECCIÓN: Mostrar precio inicial como "Selecciona una talla"
    updateDetailPrice(null, true);
    
    // Renderizar TODAS las tallas (disponibles y no disponibles)
    renderAllSizes(data.sizes);
    
    // Resetear cantidad
    elements.quantityInput.value = 1;
    elements.addToCartBtn.disabled = true;
}

function renderAllSizes(sizes) {
    const container = elements.sizesContainer;
    container.innerHTML = '';
    
    // Ordenar tallas numéricamente
    const sortedSizes = [...sizes].sort((a, b) => {
        const sizeA = parseFloat(a.size.replace('US ', ''));
        const sizeB = parseFloat(b.size.replace('US ', ''));
        return sizeA - sizeB;
    });
    
    sortedSizes.forEach(sizeData => {
        const button = document.createElement('button');
        button.className = `size-button ${!sizeData.available ? 'unavailable' : ''}`;
        button.innerHTML = `
            <span class="size-text">${sizeData.size}</span>
            <span class="size-price">${formatPrice(sizeData.price)}</span>
        `;
        button.disabled = !sizeData.available;
        
        // Mostrar tooltip para tallas no disponibles
        if (!sizeData.available) {
            button.title = 'Talla agotada - Sin stock';
        }
        
        if (sizeData.available) {
            button.addEventListener('click', () => selectSize(sizeData));
        }
        
        container.appendChild(button);
    });
}

function selectSize(sizeData) {
    __SELECTED_SIZE = sizeData;
    
    // Remover selección previa
    document.querySelectorAll('.size-button').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Agregar selección actual
    event.target.closest('.size-button').classList.add('selected');
    
    // CORRECCIÓN: Actualizar precio con el de la talla seleccionada
    updateDetailPrice(sizeData.price, false);
    
    // Habilitar botón de agregar al carrito
    elements.addToCartBtn.disabled = false;
    
    showToast(`Talla ${sizeData.size} seleccionada - ${formatPrice(sizeData.price)}`, 'info');
}

function updateDetailPrice(price, isInitial = false) {
    if (isInitial) {
        elements.detailPrice.textContent = 'Selecciona una talla';
        elements.detailPrice.style.color = 'var(--text-secondary)';
        elements.detailPrice.style.fontSize = 'var(--font-size-xl)';
        return;
    }
    
    if (price === 0 || price === null || price === undefined) {
        elements.detailPrice.textContent = 'Agotado';
        elements.detailPrice.style.color = 'var(--error-color)';
    } else {
        elements.detailPrice.textContent = formatPrice(price);
        elements.detailPrice.style.color = 'var(--accent-primary)';
        elements.detailPrice.style.fontSize = '2.5rem';
    }
}

// Navigation Functions
function goHome() {
    elements.homeView.classList.add('active');
    elements.detailView.classList.remove('active');
    __SELECTED_PRODUCT_SKU = null;
    __SELECTED_SIZE = null;
}

function goDetail(sku) {
    elements.homeView.classList.remove('active');
    elements.detailView.classList.add('active');
    renderProductDetail(sku);
}

// Event Handlers
function handleCurrencyChange() {
    __CURRENCY = elements.currencySelect.value;
    
    if (elements.homeView.classList.contains('active')) {
        renderCatalog();
    } else if (__SELECTED_PRODUCT_SKU) {
        const currentPrice = __SELECTED_SIZE ? __SELECTED_SIZE.price : null;
        updateDetailPrice(currentPrice, !__SELECTED_SIZE);
        
        // Re-renderizar tallas con nuevos precios
        const data = __PRODUCT_CACHE[__SELECTED_PRODUCT_SKU];
        renderAllSizes(data.sizes);
    }
    
    showToast(`Moneda cambiada a ${__CURRENCY}`, 'info');
}

function handleAddToCart() {
    if (!__SELECTED_SIZE) return;
    
    const quantity = parseInt(elements.quantityInput.value);
    const data = __PRODUCT_CACHE[__SELECTED_PRODUCT_SKU];
    
    showToast(
        `Agregado al carrito: ${data.title} (${__SELECTED_SIZE.size}) x${quantity} - ${formatPrice(__SELECTED_SIZE.price)}`, 
        'success'
    );
}

// Auto-refresh setup
function setupAutoRefresh() {
    // Refresh cada hora para datos en tiempo real
    setInterval(refreshProducts, 60 * 60 * 1000);
    
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            const lastRefresh = localStorage.getItem('lastRefresh');
            const now = Date.now();
            
            if (!lastRefresh || (now - parseInt(lastRefresh)) > 60 * 60 * 1000) {
                refreshProducts();
                localStorage.setItem('lastRefresh', now.toString());
            }
        }
    });
}

// Event Listeners Setup
function setupEventListeners() {
    elements.currencySelect.addEventListener('change', handleCurrencyChange);
    elements.refreshBtn.addEventListener('click', refreshProducts);
    elements.backBtn.addEventListener('click', goHome);
    elements.homeBtn.addEventListener('click', goHome);
    elements.homeNavBtn.addEventListener('click', goHome);
    
    elements.addToCartBtn.addEventListener('click', handleAddToCart);
    
    // Navegación por teclado
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.detailView.classList.contains('active')) {
            goHome();
        }
    });
}

// Initialize Application
async function initApp() {
    console.log('Initializing COURTS Sneaker Catalog with StockX...');
    
    setupEventListeners();
    setupAutoRefresh();
    
    try {
        await loadAllProducts();
        localStorage.setItem('lastRefresh', Date.now().toString());
        console.log('App initialized successfully');
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showStatus('Error al cargar el catálogo', 'error');
        showToast('Error al conectar con StockX', 'error');
    }
}

// Start the application when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
