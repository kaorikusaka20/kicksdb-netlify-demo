// COURTS Sneaker Catalog App
// Integrates with KicksDB via Netlify Functions

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
        sku: '112511810S-1 / 1125A1810S-1 / 8125A1810S-1 / 112541810SF-1'
    }
];

// Global State
let __PRODUCT_CACHE = {};
let __CURRENCY = 'USD';
let __SELECTED_PRODUCT_SKU = null;
let __SELECTED_SIZE = null;

// Exchange Rates (Static - Update in production with real API)
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
    // Views
    homeView: document.getElementById('view-home'),
    detailView: document.getElementById('view-detail'),
    
    // Navigation
    currencySelect: document.getElementById('currency-select'),
    refreshBtn: document.getElementById('refresh-btn'),
    backBtn: document.getElementById('back-btn'),
    
    // Catalog
    productGrid: document.getElementById('product-grid'),
    
    // Detail
    detailImage: document.getElementById('detail-image'),
    detailTitle: document.getElementById('detail-title'),
    detailPrice: document.getElementById('detail-price'),
    detailCurrency: document.getElementById('detail-currency'),
    sizesContainer: document.getElementById('sizes-container'),
    quantityInput: document.getElementById('quantity-input'),
    addToCartBtn: document.getElementById('add-to-cart-btn'),
    lastUpdatedTime: document.getElementById('last-updated-time'),
    
    // Status & Loading
    status: document.getElementById('status'),
    loadingOverlay: document.getElementById('loading-overlay'),
    toastContainer: document.getElementById('toast-container')
};

// Utility Functions
function formatPrice(price, currency = __CURRENCY) {
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
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 100);
    
    // Remove after 3 seconds
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
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(`Error fetching product ${sku}:`, error);
        throw error;
    }
}

async function loadAllProducts() {
    showLoading(true);
    showStatus('Cargando productos desde KicksDB...', 'loading');
    
    const loadPromises = PRODUCTS.map(async product => {
        try {
            const data = await fetchProductData(product.sku);
            __PRODUCT_CACHE[product.sku] = data;
            console.log(`Loaded product: ${product.name}`, data);
        } catch (error) {
            console.error(`Failed to load ${product.name}:`, error);
            // Create fallback data
            __PRODUCT_CACHE[product.sku] = {
                sku: product.sku,
                title: product.name,
                image: '/placeholder-sneaker.jpg',
                regularPrice: 120.00,
                lastUpdated: new Date().toISOString(),
                sizes: [
                    { size: 'US 8', price: 120.00, available: true },
                    { size: 'US 9', price: 125.00, available: true },
                    { size: 'US 10', price: 120.00, available: false }
                ]
            };
        }
    });
    
    await Promise.all(loadPromises);
    
    hideStatus();
    showLoading(false);
    renderCatalog();
}

async function refreshProducts() {
    const refreshIcon = elements.refreshBtn.querySelector('.refresh-icon');
    refreshIcon.classList.add('spinning');
    
    try {
        await loadAllProducts();
        
        // If we're on detail view, refresh that product
        if (__SELECTED_PRODUCT_SKU) {
            renderProductDetail(__SELECTED_PRODUCT_SKU);
        }
        
        showToast('Datos actualizados correctamente', 'success');
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
        
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <div class="product-image-container">
                <img src="${data.image || '/placeholder-sneaker.jpg'}" 
                     alt="${data.title}" 
                     class="product-image"
                     onerror="this.src='/placeholder-sneaker.jpg'">
            </div>
            <div class="product-info">
                <h3 class="product-name">${data.title}</h3>
                <div class="product-price">
                    <span class="price-amount">${formatPrice(data.regularPrice)}</span>
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
    
    // Update product info
    elements.detailImage.src = data.image || '/placeholder-sneaker.jpg';
    elements.detailImage.alt = data.title;
    elements.detailTitle.textContent = data.title;
    elements.lastUpdatedTime.textContent = formatDateTime(data.lastUpdated);
    
    // Set initial price to regular price
    updateDetailPrice(data.regularPrice);
    
    // Render sizes
    renderSizes(data.sizes);
    
    // Reset quantity
    elements.quantityInput.value = 1;
    elements.addToCartBtn.disabled = true;
}

function renderSizes(sizes) {
    const container = elements.sizesContainer;
    container.innerHTML = '';
    
    sizes.forEach(sizeData => {
        const button = document.createElement('button');
        button.className = `size-button ${!sizeData.available ? 'unavailable' : ''}`;
        button.textContent = sizeData.size;
        button.disabled = !sizeData.available;
        
        if (sizeData.available) {
            button.addEventListener('click', () => selectSize(sizeData));
        }
        
        container.appendChild(button);
    });
}

function selectSize(sizeData) {
    __SELECTED_SIZE = sizeData;
    
    // Update visual selection
    document.querySelectorAll('.size-button').forEach(btn => {
        btn.classList.remove('selected');
    });
    event.target.classList.add('selected');
    
    // Update price
    updateDetailPrice(sizeData.price);
    
    // Enable add to cart
    elements.addToCartBtn.disabled = false;
}

function updateDetailPrice(price) {
    elements.detailPrice.textContent = formatPrice(price);
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
    
    // Re-render prices
    if (elements.homeView.classList.contains('active')) {
        renderCatalog();
    } else if (__SELECTED_PRODUCT_SKU) {
        const data = __PRODUCT_CACHE[__SELECTED_PRODUCT_SKU];
        const currentPrice = __SELECTED_SIZE ? __SELECTED_SIZE.price : data.regularPrice;
        updateDetailPrice(currentPrice);
    }
    
    showToast(`Moneda cambiada a ${__CURRENCY}`, 'info');
}

function handleAddToCart() {
    if (!__SELECTED_SIZE) return;
    
    const quantity = parseInt(elements.quantityInput.value);
    const data = __PRODUCT_CACHE[__SELECTED_PRODUCT_SKU];
    
    showToast(
        `Agregado: ${data.title} (${__SELECTED_SIZE.size}) x${quantity} - ${formatPrice(__SELECTED_SIZE.price)}`, 
        'success'
    );
}

// Auto-refresh setup
function setupAutoRefresh() {
    // Refresh every 2 hours
    setInterval(refreshProducts, 2 * 60 * 60 * 1000);
    
    // Also refresh when page becomes visible (user returns from another tab)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            // Check if it's been more than 2 hours since last refresh
            const lastRefresh = localStorage.getItem('lastRefresh');
            const now = Date.now();
            
            if (!lastRefresh || (now - parseInt(lastRefresh)) > 2 * 60 * 60 * 1000) {
                refreshProducts();
                localStorage.setItem('lastRefresh', now.toString());
            }
        }
    });
}

// Event Listeners Setup
function setupEventListeners() {
    // Navigation
    elements.currencySelect.addEventListener('change', handleCurrencyChange);
    elements.refreshBtn.addEventListener('click', refreshProducts);
    elements.backBtn.addEventListener('click', goHome);
    
    // Product detail
    elements.addToCartBtn.addEventListener('click', handleAddToCart);
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.detailView.classList.contains('active')) {
            goHome();
        }
    });
}

// Initialize Application
async function initApp() {
    console.log('Initializing COURTS Sneaker Catalog...');
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup auto-refresh
    setupAutoRefresh();
    
    // Load initial data
    try {
        await loadAllProducts();
        localStorage.setItem('lastRefresh', Date.now().toString());
        console.log('App initialized successfully');
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showStatus('Error al cargar el catálogo', 'error');
        showToast('Error al conectar con KicksDB', 'error');
    }
}

// Start the application when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
