//routes explore.js
//Refs
//https://geojson.io/#map=0.86/25.9/17.7
//https://geojson.org/
//https://leafletjs.com/examples/geojson/

import e, {Router} from 'express';
const router = Router();

//import helpers
import * as stationData from '../data/stations.js';
import * as elevatorData from '../data/elevators.js';
import * as locationData from '../data/locations.js';


//GET /explore
router.get('/' , async(req,res) =>
{
    return res.render('explore', {title: "Explore CommutAble NYC"});
});

//GET API accepts filers and returns GeoJSON
router.get('/api', async(req,res)=> 
{
    try
    {
        //input validation 
        if(!req.query.showStations)
        {
            return res.status(400).json({error: "Missing parameter: showStations."});
        }
        if(Array.isArray(req.query.showStations))
        {
            return res.status(400).json({error: "showStations must only appear once."});
        }
        if(req.query.showStations !== "true" && req.query.showStations !== "false")
        {
            return res.status(400).json({error: "showStations must be true or false."});
        }

        if(!req.query.onlyAccessible)
        {
            return res.status(400).json({error: "Missing parameter: onlyAccessible."});
        }
        if(Array.isArray(req.query.onlyAccessible))
        {
            return res.status(400).json({error: "onlyAccessible must only appear once."});
        }
        if(req.query.onlyAccessible !== "true" && req.query.onlyAccessible!== "false")
        {
            return res.status(400).json({error: "onlyAccessible must be true or false."});
        }

        if(!req.query.showElevators)
        {
            return res.status(400).json({error: "Missing parameter: showElevators."});
        }
        if(Array.isArray(req.query.showElevators))
        {
            return res.status(400).json({error: "showElevators must only appear once."});
        }
        if(req.query.showElevators !== "true" && req.query.showElevators!== "false")
        {
            return res.status(400).json({error: "showElevators must be true or false."});
        }

        if(!req.query.showAPS)
        {
            return res.status(400).json({error: "Missing parameter: showAPS."});
        }
        if(Array.isArray(req.query.showAPS))
        {
            return res.status(400).json({error: "showAPS must only appear once."});
        }
        if(req.query.showAPS !== "true" && req.query.showAPS !== "false")
        {
            return res.status(400).json({error: "showAPS must be true or false."});
        }

        if(!req.query.showRamps)
        {
            return res.status(400).json({error: "Missing parameter: showRamps."});
        }
        if(Array.isArray(req.query.showRamps))
        {
            return res.status(400).json({error: "showRamps must only appear once."});
        }
        if(req.query.showRamps !== "true" && req.query.showRamps !== "false")
        {
            return res.status(400).json({error: "showRamps must be true or false."});
        }

        //Load stations based off filter 
        let stations = [];
        

        if(req.query.showStations === "true" || req.query.onlyAccessible === "true")
        {
            if(req.query.onlyAccessible === "true")
            {
                stations = await stationData.getAccessibleStations();

            }
             else
            {
            stations = await stationData.getAllStations();
            }
        }
    
        //Load elevators if elevators are selected
        let elevatorList = [];
        if(req.query.showElevators === "true")
        {
            elevatorList = await elevatorData.getAllElevators();
            const MAX_EL = 1500;
            if(elevatorList.length > MAX_EL)
            {
                elevatorList = elevatorList.slice(0, MAX_EL);
            }
            
        }
        //Load APS + Curb Ramps
        let apsList = [];
        if(req.query.showAPS === "true")
        {
            apsList = await locationData.getAllAPS();
        }
        let rampList = [];
        if(req.query.showRamps === "true")
        {
            rampList = await locationData.getAllCurbRamps();
            const MAX_RAMPS = 1500;
            if(rampList.length > MAX_RAMPS)
            {
                rampList = rampList.slice(0, MAX_RAMPS);
            }
        }
        //Build GeoJSON FeatureCollection 
        const features = [];
        for(let i = 0; i < stations.length; i++)
        {
            let s = stations[i];
            if(!s.location)
            {
                continue;
            }
            let lat = s.location.lat;
            let lng = s.location.lng;

            if(lat === null || lng === null)
            {
                continue;
            }
            const sid = String(s.stationId);

            features.push({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [lng, lat]
                },
                properties: 
                {
                    kind: "station",
                    stationId: sid,
                    name: s.stationName,
                    adaStatus: s.adaStatus,
                    routes: s.routes || s.daytimeRoutes || [],
                    
                }
            });
        }
        //Elevator
        for(let i = 0; i < elevatorList.length; i++)
        {
            let ev = elevatorList[i];
            if(!ev.location)
            {
                continue;
            }
            let lat = ev.location.lat;
            let lng = ev.location.lng;
            if(lat === null || lng === null)
            {
                continue;
            }
            features.push({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [lng,lat]
                },
                properties:
                {
                    kind: "elevator",
                    elevatorId: ev.elevatorId,
                    equipmentId: ev.equipmentId,
                    borough: ev.borough,
                    status: ev.status,
                    lastUpdated: ev.lastUpdated
                }
            });
        }
        //APS
        for(let i = 0; i < apsList.length; i++)
        {
            const aps= apsList[i];
            if(!aps.location)
            {
                continue;
            }
            let lat = aps.location.lat;
            let lng = aps.location.lng;
            let intersection = aps.location.intersection;
            let address = aps.location.address;
            let borough = aps.location.borough;

            features.push({
            type: "Feature",
            geometry:
            {
                type: "Point",
                coordinates: [lng, lat]
            },
            properties: 
            {
               kind: "aps",
               apdsId: String(aps._id),
               intersection: intersection || address,
               borough: borough
            }
            });
        }
        //Curb Ramps
        for(let i = 0; i < rampList.length; i++)
        {
            const ramp = rampList[i];
            if(!ramp.location)
            {
                continue;
            }
            let lat = ramp.location.lat;
            let lng = ramp.location.lng;
            features.push({
                type: "Feature",
                geometry: 
                {
                    type: "Point",
                    coordinates: [lng, lat]
                },
                properties:
                {
                    kind: "ramp",
                    rampId: String(ramp._id),
                    streetName: ramp.streetName,
                    borough: ramp.borough
                }
            });
        }
        //GeoJSON Response
        const geojson = {type: "FeatureCollection", features: features};
        return res.json(geojson);
    }
    catch (e)
    {
        return res.status(500).json({error: e.toString()});
    }
});

export default router;