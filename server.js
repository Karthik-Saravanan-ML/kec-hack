const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(cors({
  origin: [
    'https://production-system07.netlify.app/',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  credentials: true
}));



// ==================== MONGOOSE MODELS ====================

// User Model
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'manager'], default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Order Model — scoped per user
const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: String, required: true },
  itemName: { type: String, required: true },
  plannedQty: { type: Number, required: true },
  plannedRate: { type: Number, required: true },
  plannedAmount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});
orderSchema.index({ userId: 1, orderId: 1 }, { unique: true });
const Order = mongoose.model('Order', orderSchema);

// Actual Usage Model — scoped per user
const actualUsageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderId: { type: String, required: true },
  actualQty: { type: Number, required: true },
  actualRate: { type: Number, required: true },
  actualAmount: { type: Number, required: true },
  variance: { type: Number, required: true },
  status: { type: String, enum: ['Profit', 'Loss', 'Balanced'], required: true },
  createdAt: { type: Date, default: Date.now }
});
const ActualUsage = mongoose.model('ActualUsage', actualUsageSchema);

// Inventory Model — scoped per user
const inventorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  itemName: { type: String, required: true },
  currentStock: { type: Number, required: true },
  minimumStock: { type: Number, required: true },
  dailyConsumption: { type: Number, required: true },
  leadTime: { type: Number, required: true },
  safetyStock: { type: Number, required: true },
  reorderLevel: { type: Number, required: true },
  reorderQuantity: { type: Number, required: true },
  alertStatus: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});
inventorySchema.index({ userId: 1, itemName: 1 }, { unique: true });
const Inventory = mongoose.model('Inventory', inventorySchema);

// Alert Model — scoped per user
const alertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  itemName: { type: String, required: true },
  message: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  type: { type: String, enum: ['reorder', 'variance', 'stockout'], required: true },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Alert = mongoose.model('Alert', alertSchema);

// ==================== AUTH MIDDLEWARE ====================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// ==================== AUTH ROUTES ====================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = new User({ username, email, password: hashedPassword, role: role || 'admin' });
    await user.save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== DASHBOARD ====================

app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await Order.find({ userId });
    const actualUsages = await ActualUsage.find({ userId });
    const inventoryItems = await Inventory.find({ userId });
    const unreadAlerts = await Alert.find({ userId, isRead: false });

    const totalOrders = orders.length;
    const totalPlannedCost = orders.reduce((sum, o) => sum + o.plannedAmount, 0);
    const totalActualCost = actualUsages.reduce((sum, u) => sum + u.actualAmount, 0);
    const totalVariance = actualUsages.reduce((sum, u) => sum + u.variance, 0);
    const totalProfitLoss = -totalVariance;
    const lowStockItems = inventoryItems.filter(i => i.alertStatus).length;

    const recentAlerts = await Alert.find({ userId }).sort({ createdAt: -1 }).limit(5);

    const chartData = await Promise.all(orders.map(async (order) => {
      const actual = await ActualUsage.findOne({ userId, orderId: order.orderId });
      return { orderId: order.orderId, planned: order.plannedAmount, actual: actual ? actual.actualAmount : 0 };
    }));

    const inventoryLevels = inventoryItems.map(item => ({
      itemName: item.itemName,
      currentStock: item.currentStock,
      minimumStock: item.minimumStock,
      reorderLevel: item.reorderLevel
    }));

    res.json({
      stats: {
        totalOrders,
        totalPlannedCost: totalPlannedCost.toFixed(2),
        totalActualCost: totalActualCost.toFixed(2),
        totalProfitLoss: totalProfitLoss.toFixed(2),
        lowStockItems,
        recentAlerts: unreadAlerts.length
      },
      chartData: { plannedVsActual: chartData, inventoryLevels },
      recentAlerts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ORDERS ====================

app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { orderId, itemName, plannedQty, plannedRate } = req.body;
    const userId = req.user.id;
    if (!orderId || !itemName || !plannedQty || !plannedRate) return res.status(400).json({ error: 'All fields are required' });
    const plannedAmount = plannedQty * plannedRate;
    const order = new Order({ userId, orderId, itemName, plannedQty: Number(plannedQty), plannedRate: Number(plannedRate), plannedAmount });
    await order.save();
    res.status(201).json({ message: 'Order created successfully', order });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ error: 'Order ID already exists' });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/orders/:orderId', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findOne({ userId: req.user.id, orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/orders/:orderId', authenticateToken, async (req, res) => {
  try {
    const { itemName, plannedQty, plannedRate } = req.body;
    const plannedAmount = plannedQty * plannedRate;
    const order = await Order.findOneAndUpdate(
      { userId: req.user.id, orderId: req.params.orderId },
      { itemName, plannedQty, plannedRate, plannedAmount },
      { new: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ message: 'Order updated successfully', order });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/orders/:orderId', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findOneAndDelete({ userId: req.user.id, orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    await ActualUsage.findOneAndDelete({ userId: req.user.id, orderId: req.params.orderId });
    res.json({ message: 'Order deleted successfully' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== ACTUAL USAGE ====================

app.post('/api/actual-usage', authenticateToken, async (req, res) => {
  try {
    const { orderId, actualQty, actualRate } = req.body;
    const userId = req.user.id;
    if (!orderId || !actualQty || !actualRate) return res.status(400).json({ error: 'All fields are required' });
    const order = await Order.findOne({ userId, orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const actualAmount = actualQty * actualRate;
    const variance = actualAmount - order.plannedAmount;
    const status = variance > 0 ? 'Loss' : variance < 0 ? 'Profit' : 'Balanced';

    const existingUsage = await ActualUsage.findOne({ userId, orderId });
    let savedUsage;

    if (existingUsage) {
      existingUsage.actualQty = actualQty;
      existingUsage.actualRate = actualRate;
      existingUsage.actualAmount = actualAmount;
      existingUsage.variance = variance;
      existingUsage.status = status;
      await existingUsage.save();
      savedUsage = existingUsage;
    } else {
      savedUsage = await new ActualUsage({
        userId, orderId, actualQty: Number(actualQty), actualRate: Number(actualRate), actualAmount, variance, status
      }).save();
    }

    if (Math.abs(variance) > order.plannedAmount * 0.1) {
      await new Alert({
        userId, itemName: order.itemName,
        message: `High variance for order ${orderId}: ${status} of ₹${Math.abs(variance).toFixed(2)}`,
        priority: Math.abs(variance) > order.plannedAmount * 0.2 ? 'urgent' : 'high',
        type: 'variance'
      }).save();
    }

    res.status(existingUsage ? 200 : 201).json({ message: 'Actual usage saved', actualUsage: savedUsage });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/actual-usage', authenticateToken, async (req, res) => {
  try {
    const actualUsages = await ActualUsage.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(actualUsages);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/actual-usage/:orderId', authenticateToken, async (req, res) => {
  try {
    const actualUsage = await ActualUsage.findOne({ userId: req.user.id, orderId: req.params.orderId });
    if (!actualUsage) return res.status(404).json({ error: 'Actual usage not found for this order' });
    res.json(actualUsage);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== INVENTORY ====================

app.post('/api/inventory', authenticateToken, async (req, res) => {
  try {
    const { itemName, currentStock, minimumStock, dailyConsumption, leadTime, safetyStock } = req.body;
    const userId = req.user.id;
    if (!itemName || currentStock === undefined || !minimumStock || !dailyConsumption || !leadTime || safetyStock === undefined)
      return res.status(400).json({ error: 'All fields are required' });

    const reorderLevel = (dailyConsumption * leadTime) + safetyStock;
    const reorderQuantity = Math.max(0, reorderLevel - currentStock);
    const alertStatus = reorderQuantity > 0;
    const existingItem = await Inventory.findOne({ userId, itemName });

    if (existingItem) {
      Object.assign(existingItem, { currentStock, minimumStock, dailyConsumption, leadTime, safetyStock, reorderLevel, reorderQuantity, alertStatus, updatedAt: Date.now() });
      await existingItem.save();
      if (alertStatus) {
        const priority = currentStock < minimumStock ? 'urgent' : currentStock < reorderLevel * 1.2 ? 'high' : 'medium';
        await new Alert({ userId, itemName, message: `${itemName} needs reorder. Current: ${currentStock}, Reorder Qty: ${reorderQuantity.toFixed(2)}`, priority, type: 'reorder' }).save();
      }
      res.json({ message: 'Inventory updated successfully', inventory: existingItem });
    } else {
      const inventory = await new Inventory({ userId, itemName, currentStock: Number(currentStock), minimumStock: Number(minimumStock), dailyConsumption: Number(dailyConsumption), leadTime: Number(leadTime), safetyStock: Number(safetyStock), reorderLevel, reorderQuantity, alertStatus }).save();
      if (alertStatus) {
        const priority = currentStock < minimumStock ? 'urgent' : currentStock < reorderLevel * 1.2 ? 'high' : 'medium';
        await new Alert({ userId, itemName, message: `${itemName} needs reorder. Current: ${currentStock}, Reorder Qty: ${reorderQuantity.toFixed(2)}`, priority, type: 'reorder' }).save();
      }
      res.status(201).json({ message: 'Inventory item created successfully', inventory });
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/inventory', authenticateToken, async (req, res) => {
  try {
    const inventory = await Inventory.find({ userId: req.user.id }).sort({ updatedAt: -1 });
    res.json(inventory);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/inventory/low-stock', authenticateToken, async (req, res) => {
  try {
    const lowStockItems = await Inventory.find({ userId: req.user.id, alertStatus: true }).sort({ currentStock: 1 });
    res.json(lowStockItems);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/inventory/:itemName', authenticateToken, async (req, res) => {
  try {
    const inventory = await Inventory.findOneAndDelete({ userId: req.user.id, itemName: req.params.itemName });
    if (!inventory) return res.status(404).json({ error: 'Inventory item not found' });
    res.json({ message: 'Inventory item deleted successfully' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== ALERTS ====================

app.get('/api/alerts', authenticateToken, async (req, res) => {
  try {
    const alerts = await Alert.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(alerts);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/alerts/unread', authenticateToken, async (req, res) => {
  try {
    const alerts = await Alert.find({ userId: req.user.id, isRead: false }).sort({ createdAt: -1 });
    res.json(alerts);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Mark single alert as read
app.put('/api/alerts/:id/read', authenticateToken, async (req, res) => {
  try {
    const alert = await Alert.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { isRead: true },
      { new: true }
    );
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json({ message: 'Alert marked as read', alert });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Mark ALL alerts as read
app.put('/api/alerts/read-all', authenticateToken, async (req, res) => {
  try {
    await Alert.updateMany({ userId: req.user.id, isRead: false }, { isRead: true });
    res.json({ message: 'All alerts marked as read' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Delete alert
app.delete('/api/alerts/:id', authenticateToken, async (req, res) => {
  try {
    const alert = await Alert.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json({ message: 'Alert deleted successfully' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== REPORTS ====================

app.get('/api/reports/variance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await Order.find({ userId });
    const report = await Promise.all(orders.map(async (order) => {
      const actual = await ActualUsage.findOne({ userId, orderId: order.orderId });
      return {
        orderId: order.orderId, itemName: order.itemName,
        plannedAmount: order.plannedAmount, actualAmount: actual ? actual.actualAmount : 0,
        variance: actual ? actual.variance : 0, status: actual ? actual.status : 'Pending'
      };
    }));
    res.json(report);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/reports/reorder', authenticateToken, async (req, res) => {
  try {
    const inventory = await Inventory.find({ userId: req.user.id, alertStatus: true });
    const report = inventory.map(item => ({
      itemName: item.itemName, currentStock: item.currentStock, minimumStock: item.minimumStock,
      reorderLevel: item.reorderLevel, reorderQuantity: item.reorderQuantity,
      priority: item.currentStock < item.minimumStock ? 'Urgent' : 'Normal'
    }));
    res.json(report);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/reports/order-summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await Order.find({ userId });
    const summary = await Promise.all(orders.map(async (order) => {
      const actual = await ActualUsage.findOne({ userId, orderId: order.orderId });
      return {
        orderId: order.orderId, itemName: order.itemName,
        totalPlannedCost: order.plannedAmount, totalActualCost: actual ? actual.actualAmount : 0,
        totalVariance: actual ? actual.variance : 0, status: actual ? actual.status : 'Pending',
        createdAt: order.createdAt
      };
    }));
    res.json(summary);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== AI CHATBOT ====================

app.post('/api/chatbot', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.id;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const orders = await Order.find({ userId });
    const actualUsages = await ActualUsage.find({ userId });
    const inventory = await Inventory.find({ userId });
    const alerts = await Alert.find({ userId, isRead: false });

    const context = {
      totalOrders: orders.length,
      orders: orders.slice(0, 10),
      actualUsages: actualUsages.slice(0, 10),
      lowStockItems: inventory.filter(item => item.alertStatus),
      recentAlerts: alerts.slice(0, 5),
      profitOrders: actualUsages.filter(u => u.status === 'Profit').length,
      lossOrders: actualUsages.filter(u => u.status === 'Loss').length
    };

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      return res.json({ response: generateMockResponse(message, context) });
    }

    const prompt = `You are a helpful AI assistant for a Production Cost & Inventory Management System. You answer BOTH business data questions AND general questions on any topic.

Business Data:
- Total Orders: ${context.totalOrders}
- Profit Orders: ${context.profitOrders}, Loss Orders: ${context.lossOrders}
- Low Stock Items: ${context.lowStockItems.length}
- Unread Alerts: ${context.recentAlerts.length}
- Low Stock: ${JSON.stringify(context.lowStockItems.map(i => ({ name: i.itemName, current: i.currentStock, reorderQty: i.reorderQuantity })))}
- Recent Orders: ${JSON.stringify(context.orders.map(o => ({ id: o.orderId, item: o.itemName, planned: o.plannedAmount })))}
- Actual Usage: ${JSON.stringify(context.actualUsages.map(a => ({ orderId: a.orderId, actual: a.actualAmount, variance: a.variance, status: a.status })))}

User Message: ${message}

Answer helpfully. Use the business data when relevant. For general questions (greetings, general knowledge, etc.), respond naturally. Be friendly and concise.`;

    const geminiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );

    const aiResponse = geminiResponse.data.candidates[0].content.parts[0].text;
    res.json({ response: aiResponse });
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({ error: 'Failed to get AI response', details: error.message });
  }
});

function generateMockResponse(message, context) {
  const msg = message.toLowerCase().trim();

  // Greetings
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|howdy)\b/.test(msg)) {
    return `Hello! 👋 I'm your AI assistant for Production Management. I can help with your orders, inventory, profit/loss, or answer any general question. What can I do for you?`;
  }

  // How are you
  if (msg.includes('how are you') || msg.includes('how do you do')) {
    return `I'm doing great, thanks for asking! 😊 You currently have ${context.totalOrders} orders and ${context.lowStockItems.length} items needing attention. What can I help you with?`;
  }

  // Thank you
  if (/\b(thank you|thanks|thank|thx)\b/.test(msg)) {
    return `You're welcome! 😊 Feel free to ask anything else — about your production data or any general topic!`;
  }

  // Reorder / low stock
  if (msg.includes('reorder') || msg.includes('low stock') || msg.includes('out of stock')) {
    if (context.lowStockItems.length === 0) return '✅ Great news! All inventory items are well-stocked. No reorders needed right now.';
    const items = context.lowStockItems.map(i => `  • ${i.itemName} (need ${i.reorderQuantity.toFixed(2)} units)`).join('\n');
    return `⚠️ ${context.lowStockItems.length} item(s) need reordering:\n${items}`;
  }

  // Profit / loss / financial
  if (msg.includes('profit') || msg.includes('loss') || msg.includes('revenue') || msg.includes('financial') || msg.includes('earning')) {
    if (context.totalOrders === 0) return 'No orders recorded yet. Add orders and actual usage data to see profit/loss analysis.';
    const overall = context.profitOrders > context.lossOrders ? 'profit 📈' : context.lossOrders > context.profitOrders ? 'loss 📉' : 'balanced ⚖️';
    return `📊 Financial Summary:\n• Overall: ${overall}\n• Profitable orders: ${context.profitOrders}\n• Loss orders: ${context.lossOrders}\n• Total tracked: ${context.totalOrders}`;
  }

  // Variance
  if (msg.includes('variance') || msg.includes('highest variance') || msg.includes('biggest difference')) {
    if (context.actualUsages.length === 0) return 'No variance data yet. Record actual usage for your orders first.';
    const highest = context.actualUsages.reduce((max, u) => Math.abs(u.variance) > Math.abs(max.variance) ? u : max);
    return `📊 Highest variance:\n• Order: ${highest.orderId}\n• Variance: ₹${highest.variance.toFixed(2)}\n• Status: ${highest.status}`;
  }

  // Alerts
  if (msg.includes('alert') || msg.includes('notification') || msg.includes('warning')) {
    return `🔔 You have ${context.recentAlerts.length} unread alert(s). Go to the Alerts section to review and mark them as read.`;
  }

  // Orders / production
  if (msg.includes('order') || msg.includes('production')) {
    return `📦 Orders:\n• Total: ${context.totalOrders}\n• Profitable: ${context.profitOrders}\n• Loss: ${context.lossOrders}\n• Pending: ${context.totalOrders - context.profitOrders - context.lossOrders}`;
  }

  // Inventory / stock
  if (msg.includes('inventory') || msg.includes('stock') || msg.includes('item')) {
    return `🏪 Inventory: ${context.lowStockItems.length} item(s) need reordering. Check the Inventory section for full details.`;
  }

  // Help
  if (msg.includes('help') || msg.includes('what can you do') || msg.includes('what can you')) {
    return `I can help you with:\n\n📊 Business data:\n• Profit/loss status\n• Items needing reorder\n• Variance analysis\n• Alert summary\n\n💬 General questions:\n• Greetings & conversation\n• General knowledge\n• Advice & suggestions\n\nJust ask me anything!`;
  }

  // Good morning/night etc
  if (msg.includes('good morning') || msg.includes('good night') || msg.includes('good evening')) {
    return `Good ${msg.includes('night') ? 'night' : msg.includes('evening') ? 'evening' : 'morning'}! 😊 Hope your day is going well. How can I assist you with your production management today?`;
  }

  // General fallback
  return `I'm your AI assistant! Here's a quick overview of your system:\n\n• ${context.totalOrders} total orders (${context.profitOrders} profit, ${context.lossOrders} loss)\n• ${context.lowStockItems.length} items need reordering\n• ${context.recentAlerts.length} unread alerts\n\nFeel free to ask about your data or any general question! 😊`;
}

// ==================== DB + SERVER ====================

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  })
  .catch((error) => console.error('❌ MongoDB connection error:', error));

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});