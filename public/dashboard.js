const API_URL = 'https://kec-hack.onrender.com/api';
let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user'));
let charts = {};

// Check authentication
if (!token) {
    window.location.href = 'index.html';
}

// Set user info
document.getElementById('userInfo').textContent = user ? `${user.username} (${user.role})` : 'User';

// ==================== NAVIGATION ====================

const navLinks = document.querySelectorAll('.nav-link');
const pages = document.querySelectorAll('.page');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const pageName = link.dataset.page;
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        pages.forEach(p => p.classList.remove('active'));
        document.getElementById(`${pageName}Page`).classList.add('active');
        loadPageData(pageName);
    });
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
});

// ==================== API HELPER ====================

async function apiRequest(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    };
    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(`${API_URL}${endpoint}`, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }
        return data;
    } catch (error) {
        console.error('API Error:', error);
        if (error.message.includes('Invalid token') || error.message.includes('Access denied')) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = 'index.html';
        }
        throw error;
    }
}

// ==================== LOAD PAGE DATA ====================

function loadPageData(pageName) {
    switch (pageName) {
        case 'dashboard': loadDashboard(); break;
        case 'orders': loadOrders(); break;
        case 'actual': loadActualUsage(); loadOrdersForDropdown(); break;
        case 'inventory': loadInventory(); break;
        case 'alerts': loadAlerts(); break;
        case 'reports': loadReports('variance'); break;
        case 'chatbot': break;
    }
}

// ==================== DASHBOARD ====================

async function loadDashboard() {
    try {
        const data = await apiRequest('/dashboard/stats');

        document.getElementById('totalOrders').textContent = data.stats.totalOrders;
        document.getElementById('totalPlanned').textContent = `₹${parseFloat(data.stats.totalPlannedCost).toFixed(2)}`;
        document.getElementById('totalActual').textContent = `₹${parseFloat(data.stats.totalActualCost).toFixed(2)}`;

        const profitLoss = parseFloat(data.stats.totalProfitLoss);
        const profitLossElement = document.getElementById('totalProfitLoss');
        const profitLossCard = document.getElementById('profitLossCard');

        if (profitLoss > 0) {
            profitLossElement.textContent = `+₹${profitLoss.toFixed(2)}`;
            profitLossCard.style.background = 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)';
        } else if (profitLoss < 0) {
            profitLossElement.textContent = `-₹${Math.abs(profitLoss).toFixed(2)}`;
            profitLossCard.style.background = 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)';
        } else {
            profitLossElement.textContent = `₹0.00`;
        }

        document.getElementById('lowStockCount').textContent = data.stats.lowStockItems;
        document.getElementById('recentAlertsCount').textContent = data.stats.recentAlerts;

        loadPlannedVsActualChart(data.chartData.plannedVsActual);
        loadInventoryChart(data.chartData.inventoryLevels);
        displayDashboardAlerts(data.recentAlerts);
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

function loadPlannedVsActualChart(data) {
    const ctx = document.getElementById('plannedVsActualChart');
    if (charts.plannedVsActual) charts.plannedVsActual.destroy();

    if (!data || data.length === 0) {
        ctx.parentElement.querySelector('p.chart-empty') && ctx.parentElement.querySelector('p.chart-empty').remove();
        const empty = document.createElement('p');
        empty.className = 'chart-empty';
        empty.style.cssText = 'text-align:center;color:#6b7280;padding:40px 0;font-size:14px;';
        empty.textContent = 'No order data yet. Add orders to see chart.';
        ctx.parentElement.appendChild(empty);
        ctx.style.display = 'none';
        return;
    }
    ctx.style.display = '';

    charts.plannedVsActual = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.orderId),
            datasets: [
                {
                    label: 'Planned Cost (₹)',
                    data: data.map(d => d.planned),
                    backgroundColor: 'rgba(13, 110, 253, 0.8)',
                    borderColor: 'rgba(13, 110, 253, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    borderSkipped: false,
                },
                {
                    label: 'Actual Cost (₹)',
                    data: data.map(d => d.actual),
                    backgroundColor: 'rgba(220, 53, 69, 0.8)',
                    borderColor: 'rgba(220, 53, 69, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    borderSkipped: false,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { font: { size: 13 }, padding: 16, usePointStyle: true }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 12 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.06)' },
                    ticks: {
                        font: { size: 12 },
                        callback: value => '₹' + value.toLocaleString('en-IN')
                    }
                }
            }
        }
    });
}

function loadInventoryChart(data) {
    const ctx = document.getElementById('inventoryChart');
    if (charts.inventory) charts.inventory.destroy();

    if (!data || data.length === 0) {
        ctx.parentElement.querySelector('p.chart-empty') && ctx.parentElement.querySelector('p.chart-empty').remove();
        const empty = document.createElement('p');
        empty.className = 'chart-empty';
        empty.style.cssText = 'text-align:center;color:#6b7280;padding:40px 0;font-size:14px;';
        empty.textContent = 'No inventory data yet. Add inventory items to see chart.';
        ctx.parentElement.appendChild(empty);
        ctx.style.display = 'none';
        return;
    }
    ctx.style.display = '';

    charts.inventory = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.itemName.length > 14 ? d.itemName.slice(0, 14) + '…' : d.itemName),
            datasets: [
                {
                    label: 'Current Stock',
                    data: data.map(d => d.currentStock),
                    backgroundColor: data.map(d => d.currentStock <= d.minimumStock ? 'rgba(220,53,69,0.85)' : d.currentStock <= d.reorderLevel ? 'rgba(255,193,7,0.85)' : 'rgba(25,135,84,0.85)'),
                    borderColor: data.map(d => d.currentStock <= d.minimumStock ? 'rgba(220,53,69,1)' : d.currentStock <= d.reorderLevel ? 'rgba(255,193,7,1)' : 'rgba(25,135,84,1)'),
                    borderWidth: 2,
                    borderRadius: 6,
                    borderSkipped: false,
                    type: 'bar',
                    order: 2
                },
                {
                    label: 'Reorder Level',
                    data: data.map(d => d.reorderLevel),
                    borderColor: 'rgba(255, 193, 7, 1)',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 5,
                    pointBackgroundColor: 'rgba(255,193,7,1)',
                    tension: 0.3,
                    type: 'line',
                    order: 1
                },
                {
                    label: 'Min Stock',
                    data: data.map(d => d.minimumStock),
                    borderColor: 'rgba(220, 53, 69, 1)',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [3, 3],
                    pointRadius: 5,
                    pointBackgroundColor: 'rgba(220,53,69,1)',
                    tension: 0.3,
                    type: 'line',
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 12 },
                        padding: 14,
                        usePointStyle: true,
                        generateLabels: (chart) => {
                            return [
                                { text: 'Current Stock (OK)', fillStyle: 'rgba(25,135,84,0.85)', strokeStyle: 'rgba(25,135,84,1)', lineWidth: 2 },
                                { text: 'Current Stock (Low)', fillStyle: 'rgba(255,193,7,0.85)', strokeStyle: 'rgba(255,193,7,1)', lineWidth: 2 },
                                { text: 'Current Stock (Critical)', fillStyle: 'rgba(220,53,69,0.85)', strokeStyle: 'rgba(220,53,69,1)', lineWidth: 2 },
                                { text: '- - Reorder Level', fillStyle: 'transparent', strokeStyle: 'rgba(255,193,7,1)', lineWidth: 2 },
                                { text: '··· Min Stock', fillStyle: 'transparent', strokeStyle: 'rgba(220,53,69,1)', lineWidth: 2 }
                            ];
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.06)' },
                    ticks: { font: { size: 12 } }
                }
            }
        }
    });
}

function displayDashboardAlerts(alerts) {
    const container = document.getElementById('dashboardAlerts');
    if (alerts.length === 0) {
        container.innerHTML = '<p style="color:#6b7280;font-size:14px;">No recent alerts</p>';
        return;
    }
    container.innerHTML = alerts.map(alert => `
        <div class="alert-item ${alert.priority}" style="${alert.isRead ? 'opacity:0.5;' : ''}">
            <strong>${alert.itemName}</strong> — ${alert.message}
            <br><small style="color:#6b7280;">${new Date(alert.createdAt).toLocaleString()} ${alert.isRead ? '• <em>Read</em>' : ''}</small>
        </div>
    `).join('');
}

// ==================== PRODUCTION PLANNING ====================

const plannedQtyInput = document.getElementById('plannedQty');
const plannedRateInput = document.getElementById('plannedRate');
const plannedAmountDisplay = document.getElementById('plannedAmountDisplay');

function updatePlannedAmount() {
    const qty = parseFloat(plannedQtyInput.value) || 0;
    const rate = parseFloat(plannedRateInput.value) || 0;
    plannedAmountDisplay.textContent = (qty * rate).toFixed(2);
}

plannedQtyInput.addEventListener('input', updatePlannedAmount);
plannedRateInput.addEventListener('input', updatePlannedAmount);

document.getElementById('orderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = {
        orderId: document.getElementById('orderId').value,
        itemName: document.getElementById('itemName').value,
        plannedQty: parseFloat(document.getElementById('plannedQty').value),
        plannedRate: parseFloat(document.getElementById('plannedRate').value)
    };
    try {
        await apiRequest('/orders', 'POST', formData);
        showToast('Order created successfully!', 'success');
        e.target.reset();
        plannedAmountDisplay.textContent = '0.00';
        loadOrders();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
});

async function loadOrders() {
    try {
        const orders = await apiRequest('/orders');
        const tbody = document.querySelector('#ordersTable tbody');
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:20px;">No orders found. Create your first order above.</td></tr>';
            return;
        }
        tbody.innerHTML = orders.map(order => `
            <tr>
                <td><strong>${order.orderId}</strong></td>
                <td>${order.itemName}</td>
                <td>${order.plannedQty}</td>
                <td>₹${order.plannedRate.toFixed(2)}</td>
                <td>₹${order.plannedAmount.toFixed(2)}</td>
                <td>${new Date(order.createdAt).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-danger btn-small" onclick="deleteOrder('${order.orderId}')">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading orders:', error);
    }
}

async function deleteOrder(orderId) {
    if (!confirm('Delete this order and its usage data?')) return;
    try {
        await apiRequest(`/orders/${orderId}`, 'DELETE');
        showToast('Order deleted!', 'success');
        loadOrders();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

// ==================== ACTUAL CONSUMPTION ====================

const actualQtyInput = document.getElementById('actualQty');
const actualRateInput = document.getElementById('actualRate');
const actualAmountDisplay = document.getElementById('actualAmountDisplay');

function updateActualAmount() {
    const qty = parseFloat(actualQtyInput.value) || 0;
    const rate = parseFloat(actualRateInput.value) || 0;
    actualAmountDisplay.textContent = (qty * rate).toFixed(2);
}

actualQtyInput.addEventListener('input', updateActualAmount);
actualRateInput.addEventListener('input', updateActualAmount);

async function loadOrdersForDropdown() {
    try {
        const orders = await apiRequest('/orders');
        const select = document.getElementById('actualOrderId');
        select.innerHTML = '<option value="">Select Order</option>' +
            orders.map(o => `<option value="${o.orderId}">${o.orderId} — ${o.itemName}</option>`).join('');
    } catch (error) {
        console.error('Error loading orders for dropdown:', error);
    }
}

document.getElementById('actualForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = {
        orderId: document.getElementById('actualOrderId').value,
        actualQty: parseFloat(document.getElementById('actualQty').value),
        actualRate: parseFloat(document.getElementById('actualRate').value)
    };
    try {
        await apiRequest('/actual-usage', 'POST', formData);
        showToast('Actual usage recorded!', 'success');
        e.target.reset();
        actualAmountDisplay.textContent = '0.00';
        loadActualUsage();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
});

async function loadActualUsage() {
    try {
        const usages = await apiRequest('/actual-usage');
        const tbody = document.querySelector('#actualTable tbody');
        if (usages.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:20px;">No actual usage records yet.</td></tr>';
            return;
        }
        tbody.innerHTML = usages.map(usage => `
            <tr>
                <td><strong>${usage.orderId}</strong></td>
                <td>${usage.actualQty}</td>
                <td>₹${usage.actualRate.toFixed(2)}</td>
                <td>₹${usage.actualAmount.toFixed(2)}</td>
                <td style="color:${usage.variance > 0 ? '#dc3545' : usage.variance < 0 ? '#198754' : '#6c757d'}">
                    ${usage.variance > 0 ? '+' : ''}₹${usage.variance.toFixed(2)}
                </td>
                <td><span class="status-badge status-${usage.status.toLowerCase()}">${usage.status}</span></td>
                <td>${new Date(usage.createdAt).toLocaleDateString()}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading actual usage:', error);
    }
}

// ==================== INVENTORY ====================

document.getElementById('inventoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = {
        itemName: document.getElementById('invItemName').value,
        currentStock: parseFloat(document.getElementById('currentStock').value),
        minimumStock: parseFloat(document.getElementById('minimumStock').value),
        dailyConsumption: parseFloat(document.getElementById('dailyConsumption').value),
        leadTime: parseInt(document.getElementById('leadTime').value),
        safetyStock: parseFloat(document.getElementById('safetyStock').value)
    };
    try {
        await apiRequest('/inventory', 'POST', formData);
        showToast('Inventory saved!', 'success');
        e.target.reset();
        loadInventory();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
});

async function loadInventory() {
    try {
        const inventory = await apiRequest('/inventory');
        const tbody = document.querySelector('#inventoryTable tbody');
        if (inventory.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:20px;">No inventory items yet.</td></tr>';
            return;
        }
        tbody.innerHTML = inventory.map(item => `
            <tr>
                <td><strong>${item.itemName}</strong></td>
                <td>${item.currentStock}</td>
                <td>${item.minimumStock}</td>
                <td>${item.reorderLevel.toFixed(2)}</td>
                <td>${item.reorderQuantity.toFixed(2)}</td>
                <td>${item.alertStatus ?
                    '<span class="status-badge status-loss">Low Stock</span>' :
                    '<span class="status-badge status-profit">OK</span>'
                }</td>
                <td>
                    <button class="btn btn-danger btn-small" onclick="deleteInventory('${item.itemName}')">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading inventory:', error);
    }
}

async function deleteInventory(itemName) {
    if (!confirm('Delete this inventory item?')) return;
    try {
        await apiRequest(`/inventory/${encodeURIComponent(itemName)}`, 'DELETE');
        showToast('Item deleted!', 'success');
        loadInventory();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

// ==================== ALERTS ====================

let showReadAlerts = false;

async function loadAlerts() {
    try {
        const alerts = await apiRequest('/alerts');
        const container = document.getElementById('alertsContainer');

        const unreadCount = alerts.filter(a => !a.isRead).length;
        const filterBar = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
                <div>
                    <span style="font-size:14px;color:#6b7280;">${unreadCount} unread · ${alerts.length} total</span>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button onclick="toggleReadAlerts()" class="btn btn-small" style="background:${showReadAlerts ? '#6b7280' : '#f3f4f6'};color:${showReadAlerts ? '#fff' : '#374151'};border:1px solid #e5e7eb;">
                        ${showReadAlerts ? 'Hide Read' : 'Show Read'}
                    </button>
                    ${unreadCount > 0 ? `<button onclick="markAllRead()" class="btn btn-small btn-primary">Mark All as Read</button>` : ''}
                </div>
            </div>
        `;

        const filteredAlerts = showReadAlerts ? alerts : alerts.filter(a => !a.isRead);

        if (filteredAlerts.length === 0) {
            container.innerHTML = filterBar + `<p style="text-align:center;color:#6b7280;padding:40px 0;">
                ${unreadCount === 0 ? 'All caught up! No unread alerts.' : 'No alerts to show.'}
            </p>`;
            return;
        }

        container.innerHTML = filterBar + filteredAlerts.map(alert => `
            <div class="alert-card-full ${alert.priority}" id="alert-${alert._id}" style="transition:all 0.3s;${alert.isRead ? 'opacity:0.55;border-left-color:#9ca3af;' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                    <div style="flex:1;">
                        <h4>${alert.itemName} ${alert.isRead ? '<span style="font-size:11px;color:#6b7280;font-weight:normal;">(read)</span>' : ''}</h4>
                        <p>${alert.message}</p>
                        <div class="alert-meta">
                            <span class="priority-badge" style="background:${getPriorityColor(alert.priority)};color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">
                                ${alert.priority.toUpperCase()}
                            </span>
                            <span>${new Date(alert.createdAt).toLocaleString()}</span>
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;min-width:110px;align-items:flex-end;">
                        ${!alert.isRead ? `
                            <button class="btn btn-small btn-primary" onclick="markAlertRead('${alert._id}')">
                                <i class="fas fa-check"></i> Mark Read
                            </button>
                        ` : ''}
                        <button class="btn btn-small btn-danger" onclick="deleteAlert('${alert._id}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading alerts:', error);
    }
}

function getPriorityColor(priority) {
    const colors = { urgent: '#dc3545', high: '#fd7e14', medium: '#0d6efd', low: '#198754' };
    return colors[priority] || '#6c757d';
}

function toggleReadAlerts() {
    showReadAlerts = !showReadAlerts;
    loadAlerts();
}

async function markAlertRead(alertId) {
    try {
        const card = document.getElementById(`alert-${alertId}`);
        if (card) {
            card.style.opacity = '0.4';
            card.style.transform = 'scale(0.98)';
        }
        await apiRequest(`/alerts/${alertId}/read`, 'PUT');
        showToast('Alert marked as read', 'success');
        setTimeout(() => loadAlerts(), 400);
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
        loadAlerts();
    }
}

async function markAllRead() {
    try {
        await apiRequest('/alerts/read-all', 'PUT');
        showToast('All alerts marked as read!', 'success');
        loadAlerts();
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
}

async function deleteAlert(alertId) {
    if (!confirm('Delete this alert?')) return;
    try {
        const card = document.getElementById(`alert-${alertId}`);
        if (card) { card.style.opacity = '0'; card.style.transform = 'translateX(20px)'; }
        await apiRequest(`/alerts/${alertId}`, 'DELETE');
        showToast('Alert deleted', 'success');
        setTimeout(() => loadAlerts(), 300);
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
        loadAlerts();
    }
}

// ==================== REPORTS ====================

const reportTabs = document.querySelectorAll('.tab-btn');
const reportSections = document.querySelectorAll('.report-section');

reportTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const reportType = tab.dataset.report;
        reportTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        reportSections.forEach(s => s.classList.remove('active'));
        document.getElementById(`${reportType}Report`).classList.add('active');
        loadReports(reportType);
    });
});

async function loadReports(type) {
    try {
        switch (type) {
            case 'variance': await loadVarianceReport(); break;
            case 'reorder': await loadReorderReport(); break;
            case 'summary': await loadSummaryReport(); break;
        }
    } catch (error) {
        console.error('Error loading report:', error);
    }
}

async function loadVarianceReport() {
    const report = await apiRequest('/reports/variance');
    const tbody = document.querySelector('#varianceTable tbody');
    if (report.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:20px;">No data available</td></tr>';
        return;
    }
    tbody.innerHTML = report.map(row => `
        <tr>
            <td><strong>${row.orderId}</strong></td>
            <td>${row.itemName}</td>
            <td>₹${row.plannedAmount.toFixed(2)}</td>
            <td>₹${row.actualAmount.toFixed(2)}</td>
            <td style="color:${row.variance > 0 ? '#dc3545' : row.variance < 0 ? '#198754' : '#6c757d'}">
                ${row.variance > 0 ? '+' : ''}₹${row.variance.toFixed(2)}
            </td>
            <td><span class="status-badge status-${row.status.toLowerCase()}">${row.status}</span></td>
        </tr>
    `).join('');
}

async function loadReorderReport() {
    const report = await apiRequest('/reports/reorder');
    const tbody = document.querySelector('#reorderTable tbody');
    if (report.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:20px;">No items need reordering</td></tr>';
        return;
    }
    tbody.innerHTML = report.map(row => `
        <tr>
            <td><strong>${row.itemName}</strong></td>
            <td>${row.currentStock}</td>
            <td>${row.minimumStock}</td>
            <td>${row.reorderLevel.toFixed(2)}</td>
            <td>${row.reorderQuantity.toFixed(2)}</td>
            <td><span class="status-badge status-${row.priority === 'Urgent' ? 'loss' : 'balanced'}">${row.priority}</span></td>
        </tr>
    `).join('');
}

async function loadSummaryReport() {
    const report = await apiRequest('/reports/order-summary');
    const tbody = document.querySelector('#summaryTable tbody');
    if (report.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:20px;">No data available</td></tr>';
        return;
    }
    tbody.innerHTML = report.map(row => `
        <tr>
            <td><strong>${row.orderId}</strong></td>
            <td>${row.itemName}</td>
            <td>₹${row.totalPlannedCost.toFixed(2)}</td>
            <td>₹${row.totalActualCost.toFixed(2)}</td>
            <td style="color:${row.totalVariance > 0 ? '#dc3545' : row.totalVariance < 0 ? '#198754' : '#6c757d'}">
                ${row.totalVariance > 0 ? '+' : ''}₹${row.totalVariance.toFixed(2)}
            </td>
            <td><span class="status-badge status-${row.status.toLowerCase()}">${row.status}</span></td>
            <td>${new Date(row.createdAt).toLocaleDateString()}</td>
        </tr>
    `).join('');
}

// ==================== CHATBOT ====================

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

function addChatMessage(message, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isUser ? 'user' : 'bot'}`;
    messageDiv.style.whiteSpace = 'pre-wrap';
    messageDiv.textContent = message;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'chat-message bot typing-indicator';
    div.id = 'typingIndicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
}

async function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    addChatMessage(message, true);
    chatInput.value = '';
    sendChatBtn.disabled = true;

    const typing = addTypingIndicator();

    try {
        const response = await apiRequest('/chatbot', 'POST', { message });
        typing.remove();
        addChatMessage(response.response, false);
    } catch (error) {
        typing.remove();
        addChatMessage('Sorry, I encountered an error. Please try again.', false);
    } finally {
        sendChatBtn.disabled = false;
        chatInput.focus();
    }
}

sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

document.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        chatInput.value = btn.textContent;
        sendChatMessage();
    });
});

addChatMessage("Hello! I'm your AI assistant. I can help with your production & inventory data, or answer general questions. What would you like to know?", false);

// ==================== TOAST NOTIFICATIONS ====================

function showToast(message, type = 'success') {
    const existing = document.getElementById('toastNotification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 9999;
        padding: 12px 20px; border-radius: 12px; font-size: 14px; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.15); transition: all 0.3s;
        background: ${type === 'success' ? '#198754' : '#dc3545'}; color: white;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ==================== INITIALIZE ====================

loadDashboard();