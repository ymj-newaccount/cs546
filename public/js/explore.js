//DOM API 

//grab elemenets
let mapDiv = document.getElementById('map');
let filterStations = document.getElementById("filter-stations");
let filterAccessible = document.getElementById("filter-accessible");
let filterElevators = document.getElementById("filter-elevators");
let filterAPS = document.getElementById("filter-aps");
let filterRamps = document.getElementById("filter-ramps");
let list = document.getElementById("location-list");
let statusL = document.getElementById("filter-status");
let errorDiv = document.getElementById("error");
let map;
let markersLayer;



//helper to show errors
function displayError(message)
{
    if(errorDiv)
    {
        errorDiv.hidden = false;
        errorDiv.innerHTML = "Error: " + message;
    }
}
//helper to clear errors
function clearError()
{
    if(errorDiv)
    {
        errorDiv.hidden = true;
        errorDiv.innerHTML = "";
    }
}
//helper to get map with current filters
async function refreshMap()
{
    //clear errors
    clearError();

    if(statusL)
    {
        statusL.textContent = "Loading map data...";
    }
    //parameters for checkboxes 
    let params = new URLSearchParams();
    if(filterStations)
    {
        params.append("showStations", filterStations.checked);
    }
    if(filterAccessible)
    {
        params.append("onlyAccessible", filterAccessible.checked);
    }
    else
    {
        params.append("onlyAccessible", false);
    }
    if(filterElevators)
    {
        params.append("showElevators", filterElevators.checked);
    }
    else
    {
        params.append("showElevators", false);
    }
    if(filterAPS)
    {
        params.append("showAPS", filterAPS.checked);
    }
    else
    {
        params.append("showAPS", false);
    }
    if(filterRamps)
    {
        params.append("showRamps", filterRamps.checked);
    }
    else
    {
        params.append("showRamps", false);
    }
    try
    {
        let response = await fetch("/explore/api?" + params.toString());
        if(!response.ok)
        {
            displayError("Failed to load data HTTP " + response.status);
            if(statusL)
            {
                statusL.textContent = "Error loading data";
                return;
            }
        }
        let geoJSON = await response.json();
        //check data structure
        if(!geoJSON || !Array.isArray(geoJSON.features))
        {
            displayError("Invalid data format");
            if(statusL)
            {
                statusL.textContent = "Error loading data";
                return;
            }
        }
        //check if results exist
       if(geoJSON.features.length === 0)
       {
        let showStations = filterStations && filterStations.checked;
        let showAccessibleOnly = filterAccessible && filterAccessible.checked;
        let showAPS = filterAPS && filterAPS.checked;
        let showRamps = filterRamps && filterRamps.checked;
        let showElevators = filterElevators && filterElevators.checked;

        let anyFilter = showStations || showAccessibleOnly ||  showAPS || showRamps || showElevators;

        markersLayer.clearLayers();
        if(list)
        {
            list.innerHTML = "";
        }
        if(anyFilter)
        {
            displayError("No locations found for selected filters.");
            if(statusL)
            {
                statusL.textContent = "No locations to display";
            }
        }
        else
        {
            clearError();
            if(statusL)
            {
                statusL.textContent = "No filters selected";
            }
        }
        return;
        
       }
       clearError();
       markersLayer.clearLayers();
       markersLayer.addData(geoJSON);
       //fit to boundaries
       try
       {
        let bounds = markersLayer.getBounds();
        if(bounds.isValid())
        {
            map.fitBounds(bounds, {maxZoom: 18});
        }
       }
       catch (e)
       {
         console.warn("Warning: Could not fit within map bounds:", e);
       }
       updateListView(geoJSON);
       if(statusL)
       {
        statusL.textContent = geoJSON.features.length + " locations shown.";
       }
    }
    catch(e)
    {
        displayError(e.toString());
        if(statusL)
        {
            statusL.textContent = "Error loading data.";
        }

    }

}
//helper to update list view
function updateListView(geoJSON)
{
    if(!list)
    {
        displayError("List could not be found");
        return;
    }
    let showStations = filterStations && filterStations.checked;
    let showAccessibleOnly = filterAccessible && filterAccessible.checked;
    let showAPS = filterAPS && filterAPS.checked;
    let showRamps = filterRamps && filterRamps.checked;
    let showElevators = filterElevators && filterElevators.checked;


    let showStationsEffective = showStations || showAccessibleOnly;
    let anyFilter = showStationsEffective ||  showAPS || showRamps || showElevators;

    if(!anyFilter)
    {
        //no filters selected, clear list
        list.innerHTML = "";
        list.style.display = "none";
        return;
    }
    else
    {
        list.style.display = "";
    }
    list.innerHTML = "";
    for(let i = 0; i < geoJSON.features.length; i++)
    {
        let f = geoJSON.features[i];
        let p = f.properties;
        let li = document.createElement("li");
        li.tabIndex = 0;

        if(!p)
        {
            li.textContent = "Unknown Feature"
            list.appendChild(li);
            continue;
        }
        //Stations 
        if(p.kind === "station")
        {
            if(!showStationsEffective)
            {
                continue;
            }
           
            let routesText = "";
            if(Array.isArray(p.routes))
            {
                routesText = p.routes.join(", ");
            }
            else if(typeof p.routes === "string")
            {
                routesText = p.routes;
            }
            li.textContent = 
            (p.name || "Unknown Station")  +
            " | Routes: " + (routesText || "None") +
            " | Accessible " + (p.adaStatus || "Unknown");
        }
        //Elevator
        else if(p.kind === "elevator")
        {
            if(!showElevators)
            {
                continue;
            }
            li.textContent = "Elevator " +(p.elevatorId || "Not Available") +
            " | Borough: " + (p.borough || "Not Available") +
            " | Status: " + (p.status || "Not Available");
        }
        //APS
        else if(p.kind === "aps")
        {
            if(!showAPS)
            {
                continue;
            }
            li.textContent = "APS at " +
            (p.intersection || "Not available");
        }
        //RAMP
        else if (p.kind === "ramp")
        {
            if(!showRamps)
            {
                continue;
            }
            li.textContent = "Curb ramp at: " +
            p.streetName + " | " + (p.borough || "Unknown");
        }
        list.appendChild(li);

    }
}
if(mapDiv)
{
    //initialize leaflet map
    map = L.map("map").setView([40.7128, -74.0060], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 20,
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    //GeoJSON layer for all features 
    markersLayer = L.geoJSON(null, {
        onEachFeature: function(feature, layer)
        {
            let p = feature.properties;
            let popupText = "";
            if(p.kind === "station")
            {
                let routesText = "";
                if(Array.isArray(p.routes))
                {
                    routesText = p.routes.join(', ');
                }
                else if(typeof p.routes ==="string")
                {
                    routesText = p.routes;
                }
                popupText =   p.name + "<br>" +
                "Station ID: " + p.stationId + "<br>" + 
                "Accessible: " + p.adaStatus + "<br>" +
                "Routes: " + routesText + "<br>";
                
            
            }
            else if(p.kind === "elevator")
            {
                popupText = 
                "Elevator " + (p.elevatorId || "Unknown") + "<br>" +
                "Equipment ID: " + (p.equipmentId || "None") + "<br>" +
                "Borough: " + (p.borough || "Not available") +"<br>" +
                "Status: " + (p.status || "None") + "<br>" +
                "Last Updated: " +(p.lastUpdated || "None") + "<br>";

                }
            else if(p.kind === "aps")
            {
                popupText = "Accessible Pedestrian Signal (APS) <br>" +
                "Intersection: " + (p.intersection || "Not available") + "<br>" +
                "Borough: " + (p.borough || "Not available") +"<br>";

            }
            else if(p.kind === "ramp")
            {
                popupText = "Curb Ramps" +
                "Street: " + p.streetName + "<br>" +
                "Borough: " + (p.borough || "Not available") + "<br>";

            }
            else
            {
                popupText = "Unknown Feature";

            }
            layer.bindPopup(popupText);
        }
    }).addTo(map);

    //attach event listeners
    if(filterStations)
    {
        filterStations.addEventListener("change", function () {refreshMap();})
    }
    if(filterAccessible)
    {
        filterAccessible.addEventListener("change", function () {refreshMap();})
    }
    if(filterElevators)
    {
        filterElevators.addEventListener("change", function () {refreshMap();})
    }
    if(filterAPS)
    {
        filterAPS.addEventListener("change", function () {refreshMap();})
    }
    if(filterRamps)
    {
        filterRamps.addEventListener("change", function () {refreshMap();})
    }
    //load
    refreshMap();
}
else
{
    displayError("Map information not found.");
}