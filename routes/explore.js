//routes explore.js
import {Router} from 'express';
const router = Router();

//import helpers
import { getAllStations, getAccessibleStations} from '../data/stations.js';
import {getElevatorByStationId} from '../data/elevator.js';
import {getAllAPS, getAllCurbRamps} from '../data/locations.js';

router.get('/' , async(req,res) =>
{
    return res.render('explore', {title: "Explore CommutAble NYC"});
});