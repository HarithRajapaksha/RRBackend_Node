const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const haversine = require('haversine-distance');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, push, set, get, update, onValue } = require('firebase/database');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyALY_i4fAMJA3pNUXkJHOFfILbkTJiI8ZE",
  authDomain: "esp32sliitresearch.firebaseapp.com",
  databaseURL: "https://esp32sliitresearch-default-rtdb.firebaseio.com",
  projectId: "esp32sliitresearch",
  storageBucket: "esp32sliitresearch.appspot.com",
  messagingSenderId: "957117000572",
  appId: "1:957117000572:web:a5268b528db68a7e8692f9"
};

const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);

const email = "it21192050@my.sliit.lk";
const password = "200007901313";
const GOOGLE_API_KEY = "AIzaSyA13MKtYiYORFKZSCMx2PacUHecO2OOKyE";

const app = express();
require('dotenv').config(); // Load variables from .env


const PORT = process.env.PORT;
app.use(bodyParser.json());
app.use(express.json());

// Root test endpoint
app.get('/get', (req, res) => {
  res.send('Welcome to the ESP32 Data Forwarding Server!');
});

// Add GPS data to Firebase
app.post('/add/:name', async (req, res) => {
  const data = req.body;
  const BusNumber = req.params.name;

  if (!data) return res.status(400).json({ error: 'No data received' });

  const AllData = {
    ...data,
    time: new Date().toISOString(),
  };

  try {
    await signInWithEmailAndPassword(auth, email, password);
    const dbRef = ref(database, `${BusNumber}`);
    await set(dbRef, AllData);
    res.status(200).json({ message: 'Data successfully sent to Firebase' });
  } catch (error) {
    console.error('Error sending data to Firebase:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all data
app.get('/getdata', async (req, res) => {
  try {
    const dbRef = ref(database);
    const snapshot = await get(dbRef);
    if (snapshot.exists()) {
      res.status(200).json(snapshot.val());
    } else {
      res.status(404).json({ message: 'No data found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get data by bus ID
app.get('/getdata/:name', async (req, res) => {
  const Name = req.params.name;
  try {
    const dataRef = ref(database, Name);
    const snapshot = await get(dataRef);
    if (snapshot.exists()) {
      res.status(200).json(snapshot.val());
    } else {
      res.status(404).json({ message: 'No data found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


//Update realTime in Passenger Count 
app.put('/updatePassengerCount/:busId', async (req, res) => {
  const busId = req.params.busId;
  const { Passenger_Count } = req.body;

  if (Passenger_Count === undefined) {
    return res.status(400).json({ error: 'Passenger_Count is required in request body' });
  }

  try {
    // Authenticate Firebase
    await signInWithEmailAndPassword(auth, email, password);

    // Only update Passenger_Count
    const dataRef = ref(database, busId);
    await update(dataRef, {
      Passenger_Count: Passenger_Count.toString()  
    });

    res.status(200).json({ message: `Passenger_Count updated for ${busId}` });
  } catch (error) {
    console.error("❌ Error updating Passenger_Count:", error.message);
    res.status(500).json({ error: error.message });
  }
});


// Update existing data
app.put('/update/:name', async (req, res) => {
  const Name = req.params.name;
  const newData = req.body;

  if (!newData) return res.status(400).json({ error: 'No data to update' });

  const UpdatedData = {
    ...newData,
    time: new Date().toISOString(),
  };

  try {
    await signInWithEmailAndPassword(auth, email, password);
    const dataRef = ref(database, Name);
    await update(dataRef, UpdatedData);
    res.status(200).json({ message: 'Data successfully updated', Name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function getGoogleRouteDistance(originLat, originLng, destLat, destLng) {
  const url = `https://routes.googleapis.com/directions/v2:computeRoutes?key=${GOOGLE_API_KEY}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-FieldMask': 'routes.distanceMeters'  // ✅ Required field mask
  };

  const body = {
    origin: {
      location: {
        latLng: {
          latitude: originLat,
          longitude: originLng
        }
      }
    },
    destination: {
      location: {
        latLng: {
          latitude: destLat,
          longitude: destLng
        }
      }
    },
    travelMode: "DRIVE"
  };

  try {
    const response = await axios.post(url, body, { headers });

    console.log("📦 Google Maps API full response:");
    console.dir(response.data, { depth: null });

    const distance = response.data.routes?.[0]?.distanceMeters || null;
    return distance;

  } catch (err) {
    console.error("🚨 Google Maps API error:", err.response?.data || err.message);
    return null;
  }
}

// ✅ Realtime Monitor from Firebase
async function startRealTimeMonitoring() {
  await signInWithEmailAndPassword(auth, email, password);
  console.log("✅ Authenticated and listening for real-time updates...");

  const busesRef = ref(database);

  onValue(busesRef, async (snapshot) => {
    console.log("🔥 Firebase snapshot changed");

    const allBuses = snapshot.val();
    if (!allBuses) {
      console.log("❌ No bus data found in snapshot");
      return;
    }

    const busEntries = Object.entries(allBuses);

    for (const [currentBusID, currentData] of busEntries) {
      if (!currentData.latitude || !currentData.longitude) continue;

      const currentLoc = {
        latitude: currentData.latitude,
        longitude: currentData.longitude
      };

      let closestBus = null;
      let closestDistance = Infinity;

      for (const [otherBusID, otherData] of busEntries) {
        if (
          otherBusID === currentBusID ||
          !otherData.latitude ||
          !otherData.longitude
        ) continue;

        const otherLoc = {
          latitude: otherData.latitude,
          longitude: otherData.longitude
        };

        const rawDistance = haversine(currentLoc, otherLoc);
        if (rawDistance < closestDistance && rawDistance > 0) {
          closestDistance = rawDistance;
          closestBus = { id: otherBusID, ...otherLoc };
        }
      }

      if (closestBus) {
        const roadDistance = await getGoogleRouteDistance(
          currentLoc.latitude,
          currentLoc.longitude,
          closestBus.latitude,
          closestBus.longitude
        );

        console.log(`🧭 From ${currentBusID} to ${closestBus.id}`);
        console.log(`📍 Coords: (${currentLoc.latitude}, ${currentLoc.longitude}) → (${closestBus.latitude}, ${closestBus.longitude})`);
        console.log(`📏 Road distance: ${roadDistance} meters`);

        if (roadDistance !== null) {
          await update(ref(database, currentBusID), {
            Distance: roadDistance.toString()
          });

          console.log(`✅ Updated ${currentBusID} with Distance = ${roadDistance} meters`);
        }
      }
    }
  });
}



//Images upload to firebase storage
// Initialize Firebase Admin SDK
const serviceAccount = require('./firebase-adminsdk.json');


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "espresearch-a73b8.firebasestorage.app" // must be bucket ID, not full URL
});

const bucket = admin.storage().bucket();

// Create uploads folder if not exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Set up Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `image_${Date.now()}.jpg`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// Image upload route
app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No image uploaded.');
  }

  const localFilePath = path.join(__dirname, uploadDir, req.file.filename);
  const destination = `${req.file.filename}`; // Path inside Firebase Storage

  try {
    await bucket.upload(localFilePath, {
      destination: destination,
      metadata: {
        contentType: 'image/jpeg'
      }
    });

    // Make the file public (optional)
    const file = bucket.file(destination);
    await file.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${destination}`;
    console.log(`Image uploaded to Firebase: ${publicUrl}`);
    res.send({ message: 'Image uploaded successfully to Firebase.', url: publicUrl });
  } catch (error) {
    console.error('Firebase upload error:', error);
    res.status(500).send('Failed to upload image to Firebase.');
  }
});


// Start API + Firebase monitoring
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  startRealTimeMonitoring(); // 🔁 Start Firebase real-time listener
});
