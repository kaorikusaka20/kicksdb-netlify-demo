// En la sección de API Functions, reemplaza fetchProductData:
async function fetchProductData(sku) {
    try {
        const response = await fetch(`/.netlify/functions/kicksdb?sku=${encodeURIComponent(sku)}&market=US`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Mostrar info de datos en tiempo real
        if (data._source === 'KicksDB Pro') {
            console.log(`✅ Datos en tiempo real para: ${data.title}`);
            if (data._features) {
                console.log(`📊 Características:`, data._features);
            }
        }
        
        return data;
    } catch (error) {
        console.error(`Error fetching product ${sku}:`, error);
        throw error;
    }
}

// En loadAllProducts, mejora el manejo de errores:
async function loadAllProducts() {
    showLoading(true);
    showStatus('Conectando con KicksDB Pro (Tiempo Real)...', 'loading');
    
    const loadPromises = PRODUCTS.map(async product => {
        try {
            const data = await fetchProductData(product.sku);
            __PRODUCT_CACHE[product.sku] = data;
            
            // Verificar calidad de datos
            if (data._source) {
                console.log(`✅ ${product.name}: ${data._source}`);
            } else {
                console.log(`⚠️ ${product.name}: Usando datos básicos`);
            }
            
        } catch (error) {
            console.error(`Failed to load ${product.name}:`, error);
            // Crear datos de fallback mejorados
            __PRODUCT_CACHE[product.sku] = createEnhancedFallback(product);
        }
    });
    
    await Promise.all(loadPromises);
    hideStatus();
    showLoading(false);
    renderCatalog();
}

// Función de fallback mejorada
function createEnhancedFallback(product) {
    const basePrices = {
        'Anta Kai 1 Jelly': 120.00,
        'Anta Kai 2 Triple Black': 135.00, 
        'Anta Kai Hélà White': 125.00
    };
    
    const basePrice = basePrices[product.name] || 120.00;
    
    return {
        sku: product.sku,
        title: product.name,
        image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&h=500&fit=crop',
        lastUpdated: new Date().toISOString(),
        regularPrice: basePrice,
        sizes: [
            { size: 'US 8', price: basePrice, available: true },
            { size: 'US 8.5', price: basePrice + 5, available: true },
            { size: 'US 9', price: basePrice + 10, available: true },
            { size: 'US 9.5', price: basePrice + 5, available: false },
            { size: 'US 10', price: basePrice, available: true }
        ],
        _fallback: true,
        _message: 'Datos de respaldo - Verifique conexión API'
    };
}

function renderCatalog() {
    const grid = elements.productGrid;
    grid.innerHTML = '';
    
    PRODUCTS.forEach(product => {
        const data = __PRODUCT_CACHE[product.sku];
        if (!data) return;

        // Estrategia para elegir el mejor precio para la vista de lista
        let displayPrice = data.regularPrice; // Precio por defecto

        // 1. Buscar el precio más bajo disponible
        if (data.sizes && data.sizes.length > 0) {
            const availableSizes = data.sizes.filter(size => size.available);
            if (availableSizes.length > 0) {
                const lowestPriceSize = availableSizes.reduce((minSize, currentSize) => 
                    currentSize.price < minSize.price ? currentSize : minSize
                );
                displayPrice = lowestPriceSize.price;
            }
        } 
        // 2. Si no hay 'regularPrice', buscar cualquier precio en la estructura de la API
        else if (!displayPrice && data.lowest_ask) {
            displayPrice = parseFloat(data.lowest_ask);
        } else if (!displayPrice && data.retail_price_cents) {
            displayPrice = data.retail_price_cents / 100;
        }

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
                    <span class="price-amount">${formatPrice(displayPrice)}</span>
                    ${data.sizes && data.sizes.filter(s => s.available).length > 1 ? 
                      '<span class="price-variation-note">(Precios varían por talla)</span>' : ''}
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => goDetail(product.sku));
        grid.appendChild(card);
    });
}
