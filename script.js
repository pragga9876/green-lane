let map;
let allRoutes = [];
let selectedRouteIndex = 0;
let currentFromCoords = null;
let currentToCoords = null;
let currentFromAddress = '';
let currentToAddress = '';

// Initialize Leaflet map
function initMap() {
    try {
        map = L.map('map', {
            maxZoom: 19,
            minZoom: 2,
            preferCanvas: true,
            tapHold: false,
            tap: true,
            zoomControl: true,
            attributionControl: true
        }).setView([22.5726, 88.3639], 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(map);

        // Invalidate size on load to fix mobile issues
        setTimeout(function() {
            map.invalidateSize();
        }, 300);

        console.log('Map initialized successfully');
    } catch (error) {
        console.error('Map init error:', error);
    }
}

// Route colors
const routeColors = [
    { color: '#10b981', weight: 7, name: 'eco-route' },
    { color: '#f59e0b', weight: 7, name: 'balanced-route' },
    { color: '#ef4444', weight: 7, name: 'fast-route' }
];

// Dark mode
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    document.getElementById('theme-icon').textContent = isDark ? '☀️ Light' : '🌙 Dark';
    localStorage.setItem('darkMode', isDark);
}

if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    document.getElementById('theme-icon').textContent = '☀️ Light';
}

// CO2 factors
const emissionFactors = {
    'driving': 192,
    'walking': 0,
    'cycling': 21,
    'transit': 68
};

// Calculate eco score
function calculateEcoScore(mode, distanceKm) {
    const baseScores = {
        'walking': 100,
        'cycling': 95,
        'transit': 75,
        'driving': 40
    };

    let score = baseScores[mode] || 50;

    if (mode === 'driving' && distanceKm < 2) score -= 10;
    if (mode === 'walking' && distanceKm > 5) score -= 5;
    if (mode === 'cycling' && distanceKm >= 2 && distanceKm <= 15) score += 5;
    if (mode === 'transit' && distanceKm > 10) score += 5;

    return Math.max(0, Math.min(100, Math.round(score)));
}

// Calculate CO2
function calculateCO2(mode, distanceKm) {
    const factor = emissionFactors[mode] || 0;
    return Math.round(factor * distanceKm);
}

// Geocode address with mobile optimization
async function geocodeAddress(address) {
    try {
        const url = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(address) + '&limit=1&timeout=10';

        const response = await fetch(url, {
            headers: { 'User-Agent': 'VerdiGo/1.0' },
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            console.error('Geocoding response:', response.status);
            return null;
        }

        const data = await response.json();

        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lon: parseFloat(data[0].lon),
                name: data[0].display_name
            };
        }
        return null;
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}

// Build OSRM URL
function buildOSRMUrl(waypoints, profile) {
    const coords = waypoints.map(wp => wp.lng + ',' + wp.lat).join(';');
    return 'https://router.project-osrm.org/route/v1/' + profile + '/' + coords + '?geometries=geojson&overview=full';
}

// Clear routes from map
function clearMap() {
    try {
        map.eachLayer(function(layer) {
            if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
                map.removeLayer(layer);
            }
            if (layer instanceof L.Marker) {
                map.removeLayer(layer);
            }
        });
    } catch (e) {
        console.log('Clear map error:', e);
    }
    allRoutes = [];
}

// Draw routes on map
function drawRoutes(routes) {
    try {
        routes.forEach((route, idx) => {
            if (!route.polyline || !route.polyline.coordinates) return;

            const latlngs = route.polyline.coordinates.map(c => L.latLng(c[1], c[0]));

            L.polyline(latlngs, {
                color: route.color,
                weight: idx === selectedRouteIndex ? 8 : 6,
                opacity: idx === selectedRouteIndex ? 1 : 0.8,
                dashArray: idx === 0 ? 'none' : '8, 4',
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(map);
        });

        // Add markers
        L.marker([currentFromCoords.lat, currentFromCoords.lon], {
            icon: L.divIcon({
                html: '<div style="background: #10b981; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4); font-weight: bold;">A</div>',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            })
        }).addTo(map).bindPopup('Start: ' + currentFromAddress);

        L.marker([currentToCoords.lat, currentToCoords.lon], {
            icon: L.divIcon({
                html: '<div style="background: #ef4444; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4); font-weight: bold;">B</div>',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            })
        }).addTo(map).bindPopup('Destination: ' + currentToAddress);

        // Fit bounds
        try {
            const allCoords = routes.flatMap(r => r.polyline.coordinates.map(c => L.latLng(c[1], c[0])));
            const bounds = L.latLngBounds(allCoords);
            map.fitBounds(bounds.pad(0.15));
        } catch (e) {
            console.log('Fit bounds error:', e);
        }
    } catch (error) {
        console.error('Draw routes error:', error);
    }
}

// Display routes in sidebar
function displayRoutes(routes) {
    try {
        const container = document.getElementById('routes-container');
        container.innerHTML = '';

        const title = document.createElement('h3');
        title.className = 'routes-title';
        title.textContent = '🛣️ Available Routes';
        container.appendChild(title);

        routes.forEach((route, idx) => {
            let routeType = 'fast-route';
            let label = '';
            let recommendation = '';

            if (route.ecoScore >= 75) {
                routeType = 'eco-route';
                label = '🌱 Most Eco-Friendly';
                recommendation = 'Lowest emissions - Best for environment';
            } else if (route.ecoScore >= 50) {
                routeType = 'balanced-route';
                label = '⚖️ Balanced';
                recommendation = 'Good balance - Moderate emissions';
            } else {
                routeType = 'fast-route';
                label = '⚡ Least Eco-Friendly';
                recommendation = 'Fastest route - Higher carbon footprint';
            }

            const routeEl = document.createElement('div');
            routeEl.className = 'route-option ' + routeType + (idx === 0 ? ' selected' : '');
            routeEl.innerHTML = 
                '<div class="route-header">' +
                    '<div class="route-title"><span>' + label + '</span><span class="route-badge">' + route.ecoScore + '/100</span></div>' +
                '</div>' +
                '<div class="route-details">' +
                    '<div class="route-stat"><div class="stat-label">Distance</div><div class="stat-value">' + route.distance + ' km</div></div>' +
                    '<div class="route-stat"><div class="stat-label">Duration</div><div class="stat-value">' + route.duration + ' min</div></div>' +
                    '<div class="route-stat"><div class="stat-label">CO₂</div><div class="stat-value">' + route.co2 + 'g</div></div>' +
                    '<div class="route-stat"><div class="stat-label">Eco</div><div class="stat-value">' + route.ecoScore + '/100</div></div>' +
                '</div>' +
                '<div class="route-comparison"><strong>' + recommendation + '</strong></div>';

            routeEl.onclick = function() { selectRoute(idx, routes); };
            routeEl.ontouchend = function(e) { e.preventDefault(); selectRoute(idx, routes); };
            container.appendChild(routeEl);
        });

        container.classList.add('active');
    } catch (error) {
        console.error('Display routes error:', error);
    }
}

// Select route
function selectRoute(idx, routes) {
    selectedRouteIndex = idx;
    document.querySelectorAll('.route-option').forEach((el, i) => {
        el.classList.toggle('selected', i === idx);
    });
    console.log('Route', idx, 'selected');
}

// Plan route
async function planRoute() {
    const fromAddress = document.getElementById('from-input').value.trim();
    const toAddress = document.getElementById('to-input').value.trim();

    if (!fromAddress || !toAddress) {
        alert('Please enter both addresses');
        return;
    }

    document.getElementById('loading').classList.add('active');
    document.getElementById('routes-container').classList.remove('active');

    try {
        console.log('Planning route from:', fromAddress, 'to:', toAddress);

        await new Promise(r => setTimeout(r, 800));

        const fromCoords = await geocodeAddress(fromAddress);
        if (!fromCoords) {
            alert('Could not find start address. Try: "Howrah Bridge, Kolkata"');
            document.getElementById('loading').classList.remove('active');
            return;
        }

        await new Promise(r => setTimeout(r, 800));

        const toCoords = await geocodeAddress(toAddress);
        if (!toCoords) {
            alert('Could not find destination. Try: "Victoria Memorial, Kolkata"');
            document.getElementById('loading').classList.remove('active');
            return;
        }

        currentFromCoords = fromCoords;
        currentToCoords = toCoords;
        currentFromAddress = fromAddress;
        currentToAddress = toAddress;

        console.log('Addresses found. Building routes...');

        clearMap();

        const mode = document.getElementById('mode-select').value;
        let profile = 'car';
        if (mode === 'cycling') profile = 'bike';
        else if (mode === 'walking') profile = 'foot';

        // Generate 3 routes
        const routeRequests = [];

        routeRequests.push({
            waypoints: [
                L.latLng(fromCoords.lat, fromCoords.lon),
                L.latLng(toCoords.lat, toCoords.lon)
            ],
            profile: profile
        });

        const latOffset = (toCoords.lat - fromCoords.lat) * 0.08;
        const lonOffset = (toCoords.lon - fromCoords.lon) * 0.08;

        routeRequests.push({
            waypoints: [
                L.latLng(fromCoords.lat, fromCoords.lon),
                L.latLng(fromCoords.lat + latOffset, fromCoords.lon + lonOffset),
                L.latLng(toCoords.lat, toCoords.lon)
            ],
            profile: profile
        });

        routeRequests.push({
            waypoints: [
                L.latLng(fromCoords.lat, fromCoords.lon),
                L.latLng(fromCoords.lat - latOffset, fromCoords.lon - lonOffset),
                L.latLng(toCoords.lat, toCoords.lon)
            ],
            profile: profile
        });

        // Fetch all routes
        const results = [];

        for (let i = 0; i < routeRequests.length; i++) {
            try {
                const url = buildOSRMUrl(routeRequests[i].waypoints, routeRequests[i].profile);

                const response = await fetch(url, {
                    signal: AbortSignal.timeout(15000)
                });

                if (!response.ok) {
                    console.error('Route response error:', response.status);
                    continue;
                }

                const data = await response.json();

                if (data.routes && data.routes[0]) {
                    const route = data.routes[0];
                    const distKm = (route.distance / 1000).toFixed(2);
                    const durMin = Math.round(route.duration / 60);
                    const co2 = calculateCO2(mode, parseFloat(distKm));
                    const eco = calculateEcoScore(mode, parseFloat(distKm));

                    results.push({
                        polyline: route.geometry,
                        distance: distKm,
                        duration: durMin,
                        co2: co2,
                        ecoScore: eco,
                        color: routeColors[i].color
                    });

                    console.log('Route', i, 'fetched');
                }

                await new Promise(r => setTimeout(r, 600));
            } catch (error) {
                console.error('Route fetch error:', error);
            }
        }

        if (results.length === 0) {
            alert('No routes found. Check internet and try again.');
            document.getElementById('loading').classList.remove('active');
            return;
        }

        results.sort((a, b) => b.ecoScore - a.ecoScore);

        allRoutes = results;
        selectedRouteIndex = 0;

        console.log('Routes ready, drawing...');

        drawRoutes(results);
        displayRoutes(results);

        // Invalidate map size for mobile
        setTimeout(function() {
            if (map) map.invalidateSize();
        }, 100);

        document.getElementById('loading').classList.remove('active');

    } catch (error) {
        console.error('Plan route error:', error);
        alert('Error: ' + error.message);
        document.getElementById('loading').classList.remove('active');
    }
}

// Update route
function updateRoute() {
    const from = document.getElementById('from-input').value.trim();
    const to = document.getElementById('to-input').value.trim();

    if (from && to && allRoutes.length > 0) {
        planRoute();
    }
}

// Chat
function openChat() {
    alert('Chat feature coming soon!');
}

// Event listeners
document.getElementById('from-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('to-input').focus();
    }
});

document.getElementById('to-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        planRoute();
    }
});

// Prevent default touch behaviors on buttons
document.addEventListener('touchstart', function(e) {
    if (e.target.matches('.route-option, .plan-button, .chat-button, .theme-toggle')) {
        e.target.style.opacity = '0.7';
    }
}, false);

document.addEventListener('touchend', function(e) {
    if (e.target.matches('.route-option, .plan-button, .chat-button, .theme-toggle')) {
        e.target.style.opacity = '1';
    }
}, false);

// Initialize on load
window.addEventListener('load', function() {
    console.log('Page loaded, initializing...');

    // Give DOM time to render
    setTimeout(function() {
        initMap();

        // Invalidate size
        if (map) map.invalidateSize();

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                function(pos) {
                    try {
                        map.setView([pos.coords.latitude, pos.coords.longitude], 13);
                        console.log('User location set');
                    } catch (e) {
                        console.log('Geolocation error:', e);
                    }
                },
                function(error) {
                    console.log('Geolocation denied');
                }
            );
        }
    }, 100);
});

// Handle orientation change on mobile
window.addEventListener('orientationchange', function() {
    console.log('Orientation changed');
    setTimeout(function() {
        if (map) {
            map.invalidateSize();
            if (allRoutes.length > 0) {
                drawRoutes(allRoutes);
            }
        }
    }, 300);
});

console.log('Script loaded successfully');