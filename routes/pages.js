const express = require('express');
const path = require('path');
const router = express.Router();

const viewsDir = path.join(__dirname, '..', 'views');

router.get('/kiosk', (req, res) => res.sendFile(path.join(viewsDir, 'kiosk.html')));
router.get('/display', (req, res) => res.sendFile(path.join(viewsDir, 'display.html')));
router.get('/operator', (req, res) => res.sendFile(path.join(viewsDir, 'operator.html')));
router.get('/admin', (req, res) => res.sendFile(path.join(viewsDir, 'admin.html')));

// Atajos cortos para tipear en TVs (control remoto): /tv = display normal,
// /tv2 = display en modo lite (TVs de gama baja, un solo decoder de video).
router.get('/tv', (req, res) => res.redirect('/display'));
router.get('/tv2', (req, res) => res.redirect('/display?lite=1'));

// Root redirects to admin
router.get('/', (req, res) => res.redirect('/admin'));

module.exports = router;
