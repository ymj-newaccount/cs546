import express from 'express';
import { getAPSById } from '../data/aps.js';
import { getAllCurbRamps } from '../data/curbRamps.js';
import { getReportsByTarget } from '../data/reports.js';

const router = express.Router();

// Helper function to calculate distance between two lat/lng points (in km)
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get APS location data
    const aps = await getAPSById(id);
    
    // Get reports for this crossing
    const reports = await getReportsByTarget('crossing', id);
    
    // Get all curb ramps to find nearby ones
    const allRamps = await getAllCurbRamps();
    
    // Calculate distances and find nearby ramps (within 0.1 km / 100m)
    const nearbyCurbRamps = allRamps
      .map(ramp => {
        // Check different possible location structures
        let rampLat, rampLng;
        
        if (ramp.location?.coordinates) {
          // GeoJSON format: [lng, lat]
          rampLng = ramp.location.coordinates[0];
          rampLat = ramp.location.coordinates[1];
        } else if (ramp.location?.lat && ramp.location?.lng) {
          rampLat = ramp.location.lat;
          rampLng = ramp.location.lng;
        }
        
        if (!rampLat || !rampLng) return null;
        
        const distance = calculateDistance(
          aps.location.lat,
          aps.location.lng,
          rampLat,
          rampLng
        );
        
        return {
          rampId: ramp.rampId,
          attributes: {
            streetName: ramp.attributes?.streetName || ramp.streetName || 'Unknown Street',
            downSlopeCondition: ramp.attributes?.downSlopeCondition || ramp.downSlopeCondition || 'Unknown'
          },
          distance: parseFloat(distance.toFixed(4)) // Format to 4 decimal places
        };
      })
      .filter(ramp => ramp !== null && ramp.distance <= 0.1) // Within 100m
      .sort((a, b) => a.distance - b.distance) // Sort by distance
      .slice(0, 5); // Take top 5
    
    // Render the crossing page
    res.render('crossing', {
      title: `${aps.location.address} - Crossing Details`,
      apsId: aps.apsId,
      address: aps.location.address,
      borough: aps.location.borough,
      lat: aps.location.lat,
      lng: aps.location.lng,
      installDate: aps.installDate,
      nearbyCurbRamps: nearbyCurbRamps,
      reports: reports || []
    });
    
  } catch (error) {
    console.error('Error loading crossing:', error);
    res.status(404).render('crossing', {
      title: 'Crossing Not Found',
      error: 'Crossing not found',
      address: 'Unknown Crossing',
      reports: [],
      nearbyCurbRamps: []
    });
  }
});

export default router;