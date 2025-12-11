// // routes/station.js
// import express from "express";
// const router = express.Router();

// // Example: import your DB helpers
// import { getStationById } from "../data/stations.js";

// router.get("/station/:id", async (req, res) => {
//     try {
//         const id = req.params.id;
//         const station = await getStationById(id);

//         if (!station) {
//             return res.status(404).render("station", {
//                 title: "Station Not Found",
//                 error: "Station not found."
//             });
//         }

//         res.render("station", {
//             title: station.name,
//             name: station.name,
//             adaNotes: station.adaNotes,
//             outages: station.outages,
//             nearby: station.nearbyCrossings,
//             reports: station.communityReports,
//             bookmarks: station.bookmarks,
//             feed: station.feed
//         });
//     } catch (err) {
//         console.error(err);
//         res.status(500).render("station", {
//             title: "Error",
//             error: "There was a server error loading this station."
//         });
//     }
// });

// export default router;
import express from 'express';
import { getStationById } from '../data/stations.js';
import { getReportsByTarget } from '../data/reports.js';

const router = express.Router();

router.get('/station/:id', async (req, res) => {
  try {
    const stationId = req.params.id;
    
    // Get station data
    const station = await getStationById(stationId);
    
    // Get reports for this station
    const reports = await getReportsByTarget('station', stationId);
    
    // Render the station page with the station name in the title
    res.render('station', {
      title: `${station.stationName} - Station Details`,
      name: `Station - ${station.stationName}`,
      stationId: station.stationId,
      adaStatus: station.adaStatus,
      adaNotes: station.adaNotes || null,
      outages: station.outages || [],
      reports: reports || [],
      nearby: station.nearby || []
    });
    
  } catch (error) {
    console.error('Error loading station:', error);
    res.status(404).render('station', {
      title: 'Station Not Found',
      error: 'Station not found',
      name: 'Unknown Station',
      reports: [],
      outages: []
    });
  }
});

export default router;