import React,  { useEffect, useState } from 'react';
import Proj from './Components/Proj';
import { HashRouter,Routes,Route } from 'react-router-dom';

function App(){

    return(
        <HashRouter>
            <Routes>
                <Route path="/" element={<Proj/>}/>
            </Routes>
        </HashRouter>
    );
}
export default App;