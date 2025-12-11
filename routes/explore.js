//routes explore.js
//Refs
//https://geojson.io/#map=0.86/25.9/17.7
//https://geojson.org/
//https://leafletjs.com/examples/geojson/

import {Router} from 'express';
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
        //Load stations based off filter 
        let stations = [];
        

        if(req.query.showStations === "true" || req.query.onlyAccessible === "true" || req.query.showElevators === "true" )
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
        let elevators = {};
        if(req.query.showElevators === "true")
        {
            for(let i = 0; i < stations.length; i++)
            {
                let s = stations[i];
                const sid = String(s.stationId);

                const eles = await elevatorData.getElevatorsByStationId(sid);
                elevators[sid] = eles;
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
            const stationElevators = elevators[sid] || [];

            const elevatorArr = [];
            for(let j = 0; j < stationElevators.length; j++)
            {
                const e = stationElevators[j];
                elevatorArr.push({
                    elevatorId: e.elevatorId,
                    status: e.status,
                    lastUpdated: e.lastUpdated
                });
            }
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
                    elevators: elevatorArr
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